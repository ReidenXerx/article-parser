/**
 * Common surface every concrete publisher (WordPress / Shopify / …) ships.
 *
 * Mocked or real, the contract is the same: take an article id, the
 * canonical fields it needs to ship, and return a `PublishResult`. The
 * `MOCK_UPLOAD=true` env switch toggles whether the implementation talks
 * to a real HTTP API or just logs the payload — same observable shape
 * downstream so the audit panel doesn't need to special-case the mock.
 */

import { Article } from '../articles/article.entity';

export interface PublishPayload {
  /** Article title displayed in the WP / Shopify admin. */
  title: string;
  /** SEO meta title (Yoast / shopify-seo-app field). */
  metaTitle: string | null;
  /** SEO meta description. */
  metaDescription: string | null;
  /** WordPress-clean / Shopify-clean HTML body. */
  bodyHtml: string;
  /** All images, with resolved Drive direct-view URLs where applicable. */
  images: Array<{
    rawUrl: string;
    altText: string;
    driveDirectViewUrl: string | null;
  }>;
}

export type PublishStatus = 'ok' | 'skipped' | 'failed';

export interface PublishResult {
  status: PublishStatus;
  /** Provider-side ID — the post ID for WordPress, product ID for Shopify. */
  externalId: string | null;
  /** Human-readable detail (mock notice, error message, success URL). */
  detail: string;
  /** Echo of the payload we would have shipped, for the audit panel. */
  payload: PublishPayload;
  /** Whether we ran in mock mode or against a real API. */
  mock: boolean;
}

export interface Publisher {
  /** Display name used in routes + UI labels. */
  readonly name: 'wordpress' | 'shopify';
  publish(article: Article): Promise<PublishResult>;
}
