import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { Article } from '../articles/article.entity';
import { buildPublishPayload } from './publish-payload.util';
import { PublishResult, Publisher } from './publisher.interface';

/**
 * WordPress publisher.
 *
 * Defaults to MOCK mode (controlled by `MOCK_UPLOAD=true`) — the button
 * in the UI returns a fake success with the full payload echoed back,
 * exactly what the brief asks for ("static button that triggers a
 * placeholder automation"). Flip `MOCK_UPLOAD=false` and configure
 * `WORDPRESS_BASE_URL` / `WORDPRESS_USERNAME` / `WORDPRESS_APP_PASSWORD`
 * to point at a real WordPress REST API.
 *
 * In the real path we POST to `/wp-json/wp/v2/posts` with:
 *   - title              → WP post title
 *   - content            → bodyHtml
 *   - status             → 'draft' (publish step is a human review on
 *                          the WP side; never auto-publishes from our gate)
 *   - excerpt            → metaDescription (falls back gracefully when
 *                          Yoast isn't installed)
 *   - meta._yoast_wpseo_title       → metaTitle  (Yoast-aware)
 *   - meta._yoast_wpseo_metadesc    → metaDescription
 *   - Authorization      → Basic <base64(user:app-password)>
 *
 * Image upload to WP media library is left as a TODO in the brief
 * (placeholder Drive links would graduate to `wp/v2/media` calls per
 * image, then the body HTML gets img tags swapped in for the
 * placeholder anchors). We log the intent so the editor sees what
 * would happen.
 */
@Injectable()
export class WordPressService implements Publisher {
  readonly name = 'wordpress' as const;
  private readonly logger = new ArticleParserLogger(WordPressService.name);

  async publish(article: Article): Promise<PublishResult> {
    const payload = buildPublishPayload(article);
    const isMock = (process.env.MOCK_UPLOAD ?? 'true').toLowerCase() !== 'false';

    if (isMock) {
      this.logger.decide(
        'PUBLISH',
        `wordpress mock`,
        `would post "${payload.title}" (${payload.bodyHtml.length} bytes, ${payload.images.length} images)`,
      );
      return {
        status: 'ok',
        externalId: `mock-${article.id.slice(0, 8)}`,
        detail:
          'MOCK_UPLOAD=true — payload logged, no real WordPress call made.',
        payload,
        mock: true,
      };
    }

    const baseUrl = (process.env.WORDPRESS_BASE_URL ?? '').replace(/\/$/, '');
    const username = process.env.WORDPRESS_USERNAME;
    const password = process.env.WORDPRESS_APP_PASSWORD;

    if (!baseUrl || !username || !password) {
      this.logger.warn(
        'MOCK_UPLOAD=false but WORDPRESS_* env vars are not fully configured — refusing to publish',
      );
      return {
        status: 'failed',
        externalId: null,
        detail:
          'WORDPRESS_BASE_URL / WORDPRESS_USERNAME / WORDPRESS_APP_PASSWORD must all be set to publish for real.',
        payload,
        mock: false,
      };
    }

    const url = `${baseUrl}/wp-json/wp/v2/posts`;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    try {
      const response = await axios.post(
        url,
        {
          title: payload.title,
          content: payload.bodyHtml,
          status: 'draft',
          excerpt: payload.metaDescription ?? '',
          meta: {
            _yoast_wpseo_title: payload.metaTitle ?? '',
            _yoast_wpseo_metadesc: payload.metaDescription ?? '',
          },
        },
        {
          timeout: 30_000,
          headers: { Authorization: `Basic ${auth}` },
        },
      );

      const postId = response.data?.id ? String(response.data.id) : null;
      this.logger.decide(
        'PUBLISH',
        `wordpress live`,
        `status=${response.status}, postId=${postId}`,
      );
      return {
        status: 'ok',
        externalId: postId,
        detail: `Published as draft post ${postId}.`,
        payload,
        mock: false,
      };
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`WordPress publish failed: ${detail}`);
      return {
        status: 'failed',
        externalId: null,
        detail,
        payload,
        mock: false,
      };
    }
  }
}
