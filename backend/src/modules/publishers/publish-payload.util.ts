import { Article } from '../articles/article.entity';
import { PublishPayload } from './publisher.interface';

/**
 * Build the publisher-agnostic payload from a persisted article.
 *
 * Both WordPress and Shopify need the same canonical fields — title,
 * meta title, meta description, body HTML, image list — so we
 * materialise the payload once and let the per-publisher service tweak
 * the field names. The brief explicitly calls out that all four fields
 * have to be "extracted and displayed separately" → here's where they
 * land in their final, publishable form.
 */
export function buildPublishPayload(article: Article): PublishPayload {
  return {
    title: article.meta.articleTitle || '(untitled)',
    metaTitle: article.meta.metaTitle,
    metaDescription: article.meta.metaDescription,
    bodyHtml: article.bodyClean,
    images: article.images.map((img) => ({
      rawUrl: img.rawUrl,
      altText: img.altText,
      driveDirectViewUrl: img.drive?.directViewUrl ?? null,
    })),
  };
}
