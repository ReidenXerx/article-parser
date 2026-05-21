import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import {
  createEmptyUsage,
  EnhancedExtractionModule,
  ExtractionContext,
  UsageTrackedExtractionResult,
  createEnhancedResult,
} from './base/enhanced-extraction.interface';
import { ExtractedImage } from './extracted-article.types';
import {
  characterOffset,
  normaliseText,
  parseHtml,
  surroundingText,
  walkElements,
} from './utils/dom.util';
import { unwrapGoogleRedirect } from './utils/google-url.util';

/**
 * Identify every image in the article body — both real embedded `<img>`
 * tags and the placeholder-link convention writers use for Drive images.
 *
 * Two recognised shapes:
 *
 *   1. Embedded image
 *        <img src="https://lh3.googleusercontent.com/…" alt="leather collar">
 *      Comes through when the writer drag-and-drops or pastes-as-image.
 *      In editorial terms this is the "wrong" path — the brief wants
 *      images to live in Drive — but we still inventory them so the
 *      quality gate can flag "not hosted on Drive".
 *
 *   2. Placeholder link (the canonical editorial pattern in the sample doc)
 *        <a href="https://drive.google.com/file/d/{ID}/view">IMAGE 1</a>
 *        . Alt tag: "leather case"
 *      The anchor text matches /^IMAGE\s*\d+/i, the href points at Drive,
 *      and there's a trailing "Alt tag: …" annotation in the surrounding
 *      text. We pair these up so the publisher knows: fetch this Drive
 *      file, upload to WordPress media, replace this anchor with a real
 *      <img src="{wp-media-url}" alt="{altText}">.
 *
 * The Drive-permission check runs as a separate pass downstream — this
 * module's job is just discovery + alt-text + position. Fully
 * deterministic, zero AI cost.
 */
@Injectable()
export class ImageInventoryService
  implements EnhancedExtractionModule<ExtractedImage[]>
{
  readonly name = 'image-inventory';
  private readonly logger = new ArticleParserLogger(
    ImageInventoryService.name,
  );

  /** Anchor text patterns that mean "this is a Drive image placeholder". */
  private readonly PLACEHOLDER_ANCHOR_RX = /^\s*IMAGE\s*\d+\s*$/i;

  /**
   * Trailing alt-tag annotation pattern, matched against the placeholder
   * link's surrounding paragraph text. Handles smart quotes the sample
   * doc uses.
   */
  private readonly ALT_TAG_ANNOTATION_RX =
    /Alt\s*tag\s*[:\-]?\s*["“”']([^"“”']+)["“”']/i;

  async extractWithUsage(
    html: string,
    _context?: ExtractionContext,
  ): Promise<UsageTrackedExtractionResult<ExtractedImage[]>> {
    const { body } = parseHtml(html);

    const images: ExtractedImage[] = [];

    // ── 1. Embedded <img> tags ───────────────────────────────────────
    for (const el of walkElements(body)) {
      if (el.tagName !== 'IMG') continue;
      const img = el as HTMLImageElement;
      const src = img.getAttribute('src') ?? '';
      if (!src) continue;

      images.push({
        position: characterOffset(body, img),
        rawUrl: src,
        altText: normaliseText(img.getAttribute('alt') ?? ''),
        kind: 'embedded',
        surroundingText: surroundingText(img),
      });
    }

    // ── 2. Placeholder links (anchor text = "IMAGE N") ───────────────
    for (const el of walkElements(body)) {
      if (el.tagName !== 'A') continue;
      const anchor = el as HTMLAnchorElement;
      const rawHref = anchor.getAttribute('href') ?? '';
      const href = unwrapGoogleRedirect(rawHref);
      const text = normaliseText(anchor.textContent ?? '');
      if (!this.PLACEHOLDER_ANCHOR_RX.test(text)) continue;

      // Pull the alt tag from the surrounding paragraph text. We walk
      // up to the containing paragraph because the alt annotation lives
      // on the same line as the placeholder anchor in the source doc.
      const surrounding = surroundingText(anchor, 600);
      const altMatch = this.ALT_TAG_ANNOTATION_RX.exec(surrounding);
      const altText = altMatch ? normaliseText(altMatch[1]) : '';

      images.push({
        position: characterOffset(body, anchor),
        rawUrl: href,
        altText,
        kind: 'placeholder-link',
        surroundingText: surrounding,
      });
    }

    images.sort((a, b) => a.position - b.position);

    this.logger.decide(
      'IMAGE-SCAN',
      `found ${images.length} images`,
      `embedded=${images.filter((i) => i.kind === 'embedded').length}, placeholder=${images.filter((i) => i.kind === 'placeholder-link').length}`,
    );

    return createEnhancedResult(images, 1, createEmptyUsage());
  }
}
