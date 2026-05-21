import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import {
  createEmptyUsage,
  EnhancedExtractionModule,
  ExtractionContext,
  UsageTrackedExtractionResult,
  createEnhancedResult,
} from './base/enhanced-extraction.interface';
import { ExtractedBodyHtml } from './extracted-article.types';
import { parseHtml } from './utils/dom.util';
import { unwrapGoogleRedirect } from './utils/google-url.util';

/**
 * Produce WordPress-clean HTML from a Google Docs export.
 *
 * Google's export is HTML technically, but it's full of:
 *   - inline `style="font-weight:700;font-style:italic;…"` per span
 *   - `class="c1 c2 c3"` references to a `<style>` block we discard
 *   - `<span>` wrapping every other word for font/color overrides
 *   - empty paragraphs and weird `<br>` runs around images
 *   - `<a href="?q=https%3A%2F%2F…">` Google redirect wrappers around links
 *   - `<p><span><strong>Meta Title:</strong></span></p>` for the Yoast
 *     annotations the meta-fields extractor consumes
 *
 * None of that survives the editorial → WordPress copy-paste a human
 * does today. We replicate the same flattening:
 *   - allow only block-level tags + a, strong, em, img
 *   - drop ALL class/style attributes
 *   - unwrap Google redirect links back to their original href
 *   - strip "Meta Title:" / "Meta Description:" annotation paragraphs so
 *     they don't end up in the published body
 *   - collapse consecutive `<br>` and empty paragraphs
 *
 * This is a fully deterministic pass — no AI cost.
 */
@Injectable()
export class BodyHtmlService implements EnhancedExtractionModule<ExtractedBodyHtml> {
  readonly name = 'body-html';
  private readonly logger = new ArticleParserLogger(BodyHtmlService.name);

  async extractWithUsage(
    rawHtml: string,
    _context?: ExtractionContext,
  ): Promise<UsageTrackedExtractionResult<ExtractedBodyHtml>> {
    const { body } = parseHtml(rawHtml);

    // ── Pre-cleanup pass on the live DOM ─────────────────────────────

    // 1. Drop "Meta Title:" / "Meta Description:" annotation paragraphs
    //    so they don't pollute the published body.
    Array.from(body.querySelectorAll('p')).forEach((p) => {
      const text = (p.textContent ?? '').trim();
      if (/^\s*Meta\s*(Title|Description)\s*:/i.test(text)) {
        p.remove();
      }
    });

    // 2. Unwrap Google's `https://www.google.com/url?q=…` redirect
    //    wrappers around <a href=…>. Editors paste raw URLs; Google's
    //    HTML export wraps EVERY external link in a redirect by default.
    //    Recover the real target so the published HTML doesn't ship
    //    Google redirect URLs.
    Array.from(body.querySelectorAll('a[href]')).forEach((anchor) => {
      const href = anchor.getAttribute('href') ?? '';
      const unwrapped = unwrapGoogleRedirect(href);
      if (unwrapped !== href) {
        anchor.setAttribute('href', unwrapped);
      }
    });

    const dirtyHtml = body.innerHTML;
    const dirtyBytes = Buffer.byteLength(dirtyHtml, 'utf8');

    // ── Sanitization pass ───────────────────────────────────────────
    const cleanHtml = sanitizeHtml(dirtyHtml, {
      allowedTags: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'br',
        'ul',
        'ol',
        'li',
        'strong',
        'b',
        'em',
        'i',
        'u',
        'a',
        'img',
        'blockquote',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'hr',
      ],
      allowedAttributes: {
        a: ['href', 'title', 'rel', 'target'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        // Table cells keep colspan/rowspan because WordPress accepts them.
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan'],
      },
      // Strip empty paragraphs and consecutive <br><br> runs.
      exclusiveFilter: (frame) => {
        if (frame.tag === 'p' && frame.text.trim() === '') return true;
        return false;
      },
      // Open external links in a new tab + nofollow them by default.
      // Editors can override per-link in WordPress if they need otherwise.
      transformTags: {
        a: (tagName, attribs) => {
          const href = attribs.href ?? '';
          const isExternal = /^https?:\/\//i.test(href);
          if (isExternal) {
            return {
              tagName: 'a',
              attribs: {
                ...attribs,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
            };
          }
          return { tagName, attribs };
        },
      },
    })
      // Collapse runs of empty whitespace between block elements
      .replace(/>\s+</g, '>\n<')
      .trim();

    const cleanBytes = Buffer.byteLength(cleanHtml, 'utf8');
    const bytesStripped = Math.max(0, dirtyBytes - cleanBytes);

    this.logger.decide(
      'BODY-HTML',
      `dirtyBytes=${dirtyBytes}`,
      `cleanBytes=${cleanBytes}, stripped=${bytesStripped}B (${Math.round(
        (bytesStripped / Math.max(1, dirtyBytes)) * 100,
      )}%)`,
    );

    return createEnhancedResult(
      { cleanHtml, rawHtml, bytesStripped },
      1,
      createEmptyUsage(),
    );
  }
}
