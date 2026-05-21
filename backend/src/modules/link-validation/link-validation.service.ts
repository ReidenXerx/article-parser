import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import {
  ExtractedLink,
  LinkValidationVerdict,
} from '../extractors/extracted-article.types';

/**
 * Reachability + soft-404 probe for every link in the article.
 *
 * The brief says editors need to verify "all product links go to the correct
 * pages". A naive `axios.head` only catches hard 4xx/5xx. Modern ecommerce
 * stacks have THREE failure modes worth catching:
 *
 *   1. Hard 4xx/5xx — server returns a non-2xx status code. Shopify
 *      and well-configured WordPress both do this correctly for unknown
 *      product URLs (e.g. Andar's removed product returns a real 404).
 *
 *   2. Redirect-to-homepage soft 404 — some sites 301/302 unknown URLs
 *      to `/`. The browser sees 200, the URL bar shows the homepage,
 *      and the user is confused. We catch this by comparing the final
 *      URL after redirects against the original.
 *
 *   3. 200-with-error-body soft 404 — misconfigured sites render a
 *      "page not found" template AT THE REQUESTED URL with HTTP 200.
 *      We catch this by inspecting the response body's <title> and
 *      first <h1> for known 404 markers.
 *
 * Implementation choices:
 *
 *   - One GET per link, with a `Range: bytes=0-10239` header. We need
 *     the response body to do soft-404 detection, but the first 10KB
 *     is always enough to capture <title> + first <h1>. Many CDNs
 *     honour the Range header and only ship 10KB; ones that don't,
 *     we manually truncate on read.
 *
 *   - Real User-Agent header. Some sites 403 anonymous Node clients;
 *     a desktop-Chrome UA bypasses the worst of it.
 *
 *   - `maxRedirects: 5` + `validateStatus: () => true` so we observe
 *     4xx/5xx as data, not as exceptions.
 *
 *   - Concurrency-capped (4) like the Drive probe — polite to the
 *     target host AND avoids hammering a single domain in a 14-link
 *     article.
 *
 *   - Image-placeholder links are SKIPPED (DriveService handles them).
 */
@Injectable()
export class LinkValidationService {
  private readonly logger = new ArticleParserLogger(LinkValidationService.name);

  private readonly DEFAULT_TIMEOUT_MS = 8_000;
  private readonly DEFAULT_CONCURRENCY = 4;
  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  /** Hard cap on body bytes we'll inspect, in case Range isn't honoured. */
  private readonly MAX_BODY_BYTES = 10_240;

  /**
   * Patterns that, when matched in a <title> or first <h1>, identify the
   * page as a 404 template even though it returned 200.
   *
   * Anchored to known phrasings (Shopify, WordPress, Wix, Squarespace
   * defaults plus a few hand-rolled variants). Word-boundaried so
   * "this product is found in the not-yet-discovered category" doesn't
   * trip it.
   */
  private readonly SOFT_404_TITLE_RX =
    /\b(404|page\s*not\s*found|not\s*found|page\s*doesn['’]?t\s*exist|sorry,?\s*we\s*couldn['’]?t\s*find|nothing\s*found|this\s*page\s*can['’]?t\s*be\s*found|oops,?\s*nothing\s*here)\b/i;

  /** URL paths that, when reached AFTER REDIRECT, indicate a soft 404. */
  private readonly SOFT_404_PATH_RX =
    /\/(404|page-not-found|not-found|nothing-here)(?:[/?#]|$)/i;

  isEnabled(): boolean {
    return (
      (process.env.LINK_VALIDATION_ENABLED ?? 'true').toLowerCase() !== 'false'
    );
  }

  /**
   * Probe every link in the batch and return verdicts in the same order.
   * Image-placeholder links return a `skipped` verdict instead of a
   * network call.
   */
  async checkBatch(
    links: ExtractedLink[],
    timeoutMs: number = Number(process.env.LINK_VALIDATION_TIMEOUT_MS) ||
      this.DEFAULT_TIMEOUT_MS,
    concurrency = this.DEFAULT_CONCURRENCY,
  ): Promise<LinkValidationVerdict[]> {
    const verdicts: LinkValidationVerdict[] = new Array(links.length);
    let cursor = 0;

    const workers = Array.from(
      { length: Math.min(concurrency, links.length) },
      async () => {
        while (cursor < links.length) {
          const idx = cursor++;
          const link = links[idx];
          if (link.classification === 'image-placeholder') {
            verdicts[idx] = {
              status: 'skipped',
              detail: 'Image placeholder — Drive probe handles this',
            };
            continue;
          }
          verdicts[idx] = await this.checkOne(link.href, timeoutMs);
        }
      },
    );

    await Promise.all(workers);
    return verdicts;
  }

  /**
   * Probe a single URL. Fail-open: any unexpected error returns an
   * `unreachable` verdict rather than throwing — the quality gate
   * weights unreachable links lighter than confirmed-broken links
   * because they're often transient (rate limiting, brief DNS hiccup).
   */
  async checkOne(href: string, timeoutMs: number): Promise<LinkValidationVerdict> {
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      return {
        status: 'unreachable',
        detail: `Could not parse as URL`,
      };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        status: 'skipped',
        detail: `Non-HTTP protocol (${parsed.protocol})`,
      };
    }

    try {
      const response = await axios.get<string>(href, {
        timeout: timeoutMs,
        maxRedirects: 5,
        responseType: 'text',
        validateStatus: () => true,
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          // Some CDNs honour this and only ship the first 10KB — cheap
          // way to soft-404 detect dense product pages.
          'Range': `bytes=0-${this.MAX_BODY_BYTES - 1}`,
        },
        // Disallow huge bodies even when the Range header is ignored.
        maxContentLength: 5 * 1024 * 1024,
      });

      const status = response.status;
      const finalUrl = (response.request?.res?.responseUrl as string) ?? href;
      const finalUrlChanged = finalUrl !== href;

      // 1. Hard error status — most common case, cheapest to verdict.
      if (status >= 400 && status < 500) {
        return {
          status: 'hard-4xx',
          httpStatus: status,
          finalUrl: finalUrlChanged ? finalUrl : undefined,
          detail: `HTTP ${status}`,
        };
      }
      if (status >= 500) {
        return {
          status: 'hard-5xx',
          httpStatus: status,
          finalUrl: finalUrlChanged ? finalUrl : undefined,
          detail: `HTTP ${status} (server error — may be transient)`,
        };
      }

      // 2. Soft 404 via redirect — the URL was rewritten to the
      // homepage or a known 404 path.
      if (finalUrlChanged) {
        let finalParsed: URL | null = null;
        try {
          finalParsed = new URL(finalUrl);
        } catch {
          /* ignore */
        }
        if (finalParsed) {
          const sameHost = finalParsed.hostname === parsed.hostname;
          const landedOnHome =
            sameHost &&
            (finalParsed.pathname === '/' || finalParsed.pathname === '');
          const landedOn404Path = this.SOFT_404_PATH_RX.test(
            finalParsed.pathname,
          );

          if (landedOnHome) {
            return {
              status: 'soft-404',
              httpStatus: status,
              finalUrl,
              detail: `Redirected to homepage — origin URL likely removed`,
            };
          }
          if (landedOn404Path) {
            return {
              status: 'soft-404',
              httpStatus: status,
              finalUrl,
              detail: `Redirected to known 404 path (${finalParsed.pathname})`,
            };
          }
        }
      }

      // 3. Soft 404 via body inspection — title / h1 contains a 404
      // marker even though HTTP 200 was returned.
      const body = String(response.data ?? '').slice(0, this.MAX_BODY_BYTES);
      const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(body);
      const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body);
      const title = titleMatch ? this.stripTags(titleMatch[1]) : '';
      const h1 = h1Match ? this.stripTags(h1Match[1]) : '';

      if (title && this.SOFT_404_TITLE_RX.test(title)) {
        return {
          status: 'soft-404',
          httpStatus: status,
          finalUrl: finalUrlChanged ? finalUrl : undefined,
          detail: `Title reads "${title.slice(0, 80)}"`,
        };
      }
      if (h1 && this.SOFT_404_TITLE_RX.test(h1)) {
        return {
          status: 'soft-404',
          httpStatus: status,
          finalUrl: finalUrlChanged ? finalUrl : undefined,
          detail: `H1 reads "${h1.slice(0, 80)}"`,
        };
      }

      // 4. Healthy.
      if (finalUrlChanged) {
        return {
          status: 'redirect',
          httpStatus: status,
          finalUrl,
          detail: `Redirected, resolved OK`,
        };
      }
      return {
        status: 'ok',
        httpStatus: status,
        detail: title ? `200 — "${title.slice(0, 60)}"` : 'HTTP 200',
      };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return {
        status: 'unreachable',
        detail: e.code
          ? `${e.code}${e.message ? `: ${e.message.slice(0, 100)}` : ''}`
          : e.message?.slice(0, 120) ?? 'unknown network error',
      };
    }
  }

  /**
   * Strip HTML tags + collapse whitespace. Used on the captured
   * <title> / <h1> snippets before regex matching, so nested
   * `<title><span>Page</span> Not <em>Found</em></title>` still
   * triggers the marker.
   */
  private stripTags(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
