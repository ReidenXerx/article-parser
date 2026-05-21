import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import {
  createEmptyUsage,
  EnhancedExtractionModule,
  ExtractionContext,
  UsageTrackedExtractionResult,
  createEnhancedResult,
} from './base/enhanced-extraction.interface';
import { ExtractedLink } from './extracted-article.types';
import {
  characterOffset,
  normaliseText,
  parseHtml,
  walkElements,
} from './utils/dom.util';
import { unwrapGoogleRedirect } from './utils/google-url.util';

/**
 * Inventory every `<a href>` in the article body and classify each by
 * intent.
 *
 * Classification taxonomy:
 *   product            → links to a product/collection page on the client
 *                        domain (the SEO team's "money links")
 *   brand              → bare-host link to the client domain (homepage)
 *   internal           → any other link on the client domain
 *   external           → off-domain link
 *   image-placeholder  → "IMAGE N" Drive placeholder (skipped from the
 *                        product-link count)
 *
 * The product / brand split is driven by env-configurable host + path
 * patterns (`QUALITY_PRODUCT_HOST_PATTERNS` + `QUALITY_PRODUCT_PATH_PATTERNS`).
 * Falling back to defaults means the rule works out-of-the-box for the
 * sample article (`andar.com/products/*`, `andar.com/collections/*`) and
 * accommodates per-client overrides later.
 */
@Injectable()
export class LinkInventoryService
  implements EnhancedExtractionModule<ExtractedLink[]>
{
  readonly name = 'link-inventory';
  private readonly logger = new ArticleParserLogger(LinkInventoryService.name);

  private readonly PLACEHOLDER_ANCHOR_RX = /^\s*IMAGE\s*\d+\s*$/i;

  private readonly DEFAULT_PRODUCT_PATH_PATTERNS = [
    '/products/',
    '/collections/',
    '/product/',
    '/shop/',
  ];

  async extractWithUsage(
    html: string,
    _context?: ExtractionContext,
  ): Promise<UsageTrackedExtractionResult<ExtractedLink[]>> {
    const { body } = parseHtml(html);

    const clientHostPatterns = parseEnvList(
      process.env.QUALITY_PRODUCT_HOST_PATTERNS,
    );
    const productPathPatterns = parseEnvList(
      process.env.QUALITY_PRODUCT_PATH_PATTERNS,
      this.DEFAULT_PRODUCT_PATH_PATTERNS,
    );

    const links: ExtractedLink[] = [];

    for (const el of walkElements(body)) {
      if (el.tagName !== 'A') continue;
      const anchor = el as HTMLAnchorElement;
      const rawHref = anchor.getAttribute('href') ?? '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:'))
        continue;

      // Resolve Google redirect wrappers BEFORE classification so links
      // classify by their TRUE destination host (andar.com/products/…),
      // not the redirect host (www.google.com).
      const href = unwrapGoogleRedirect(rawHref);
      const anchorText = normaliseText(anchor.textContent ?? '');

      const classification = this.classify(
        href,
        anchorText,
        clientHostPatterns,
        productPathPatterns,
      );

      links.push({
        position: characterOffset(body, anchor),
        href,
        anchorText,
        classification,
      });
    }

    links.sort((a, b) => a.position - b.position);

    // Group counts for the decision log line
    const counts = links.reduce<Record<string, number>>(
      (acc, l) => ({ ...acc, [l.classification]: (acc[l.classification] ?? 0) + 1 }),
      {},
    );

    this.logger.decide(
      'LINK-SCAN',
      `found ${links.length} links`,
      Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    );

    return createEnhancedResult(links, 1, createEmptyUsage());
  }

  private classify(
    href: string,
    anchorText: string,
    clientHostPatterns: string[],
    productPathPatterns: string[],
  ): ExtractedLink['classification'] {
    if (this.PLACEHOLDER_ANCHOR_RX.test(anchorText)) return 'image-placeholder';

    let parsed: URL | null = null;
    try {
      parsed = new URL(href);
    } catch {
      // Relative or malformed link — treat as internal
      return 'internal';
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // If no QUALITY_PRODUCT_HOST_PATTERNS configured, treat ALL hosts as
    // candidates for the product/internal classification. This is the
    // default behaviour out-of-the-box — the rule still differentiates
    // product paths from non-product paths, just on whatever domain the
    // writer linked to.
    const isClientHost =
      clientHostPatterns.length === 0
        ? true
        : clientHostPatterns.some((p) => host.includes(p.toLowerCase()));

    if (!isClientHost) return 'external';

    // Bare host (homepage) → brand link
    if (path === '/' || path === '') return 'brand';

    if (productPathPatterns.some((p) => path.includes(p.toLowerCase()))) {
      return 'product';
    }

    return 'internal';
  }
}

function parseEnvList(raw: string | undefined, fallback: string[] = []): string[] {
  if (!raw) return fallback;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}
