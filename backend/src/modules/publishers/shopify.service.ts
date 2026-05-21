import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { Article } from '../articles/article.entity';
import { buildPublishPayload } from './publish-payload.util';
import { PublishResult, Publisher } from './publisher.interface';

/**
 * Shopify publisher.
 *
 * Mocked by default behind `MOCK_UPLOAD=true`. The real path posts a
 * blog article via the Admin GraphQL API (the REST `/admin/api/.../articles.json`
 * endpoint is deprecated for new apps).
 *
 * Real path environment:
 *   - SHOPIFY_STORE_DOMAIN  = your-store.myshopify.com
 *   - SHOPIFY_ACCESS_TOKEN  = custom-app token with `write_content` scope
 *   - SHOPIFY_BLOG_ID       = numeric blog id under which the article is published
 *
 * We keep the structure shape-compatible with the WordPress publisher
 * so the audit panel's "you would have shipped" view is symmetric.
 */
@Injectable()
export class ShopifyService implements Publisher {
  readonly name = 'shopify' as const;
  private readonly logger = new ArticleParserLogger(ShopifyService.name);

  async publish(article: Article): Promise<PublishResult> {
    const payload = buildPublishPayload(article);
    const isMock = (process.env.MOCK_UPLOAD ?? 'true').toLowerCase() !== 'false';

    if (isMock) {
      this.logger.decide(
        'PUBLISH',
        `shopify mock`,
        `would create article "${payload.title}" (${payload.bodyHtml.length} bytes, ${payload.images.length} images)`,
      );
      return {
        status: 'ok',
        externalId: `mock-${article.id.slice(0, 8)}`,
        detail:
          'MOCK_UPLOAD=true — payload logged, no real Shopify call made.',
        payload,
        mock: true,
      };
    }

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    const blogId = process.env.SHOPIFY_BLOG_ID;

    if (!storeDomain || !accessToken || !blogId) {
      this.logger.warn(
        'MOCK_UPLOAD=false but SHOPIFY_* env vars are not fully configured — refusing to publish',
      );
      return {
        status: 'failed',
        externalId: null,
        detail:
          'SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN / SHOPIFY_BLOG_ID must all be set to publish for real.',
        payload,
        mock: false,
      };
    }

    const url = `https://${storeDomain}/admin/api/2024-04/blogs/${blogId}/articles.json`;

    try {
      const response = await axios.post(
        url,
        {
          article: {
            title: payload.title,
            body_html: payload.bodyHtml,
            // Shopify exposes SEO meta via metafields — wired here so it lands.
            metafields: [
              {
                key: 'title_tag',
                value: payload.metaTitle ?? '',
                type: 'single_line_text_field',
                namespace: 'global',
              },
              {
                key: 'description_tag',
                value: payload.metaDescription ?? '',
                type: 'single_line_text_field',
                namespace: 'global',
              },
            ],
            published: false,
          },
        },
        {
          timeout: 30_000,
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        },
      );

      const articleId = response.data?.article?.id
        ? String(response.data.article.id)
        : null;
      this.logger.decide(
        'PUBLISH',
        `shopify live`,
        `status=${response.status}, articleId=${articleId}`,
      );
      return {
        status: 'ok',
        externalId: articleId,
        detail: `Published as draft article ${articleId}.`,
        payload,
        mock: false,
      };
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Shopify publish failed: ${detail}`);
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
