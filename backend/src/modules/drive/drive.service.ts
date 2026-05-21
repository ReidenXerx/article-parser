import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';

export type DrivePermissionVerdict =
  | 'public'
  | 'private'
  | 'not-drive'
  | 'unknown';

export interface DriveImageInfo {
  rawUrl: string;
  fileId: string | null;
  /** Direct-view URL we can pass to <img src=...> if public. */
  directViewUrl: string | null;
  /** Result of the public-accessibility HEAD probe. */
  permission: DrivePermissionVerdict;
  /** HTTP status the HEAD probe returned (when applicable). */
  status?: number;
}

/**
 * Drive URL recognition + public-accessibility probe.
 *
 * The brief calls out two requirements per image:
 *   1. "Hosted on Google Drive" — we recognise the canonical URL shapes
 *      writers paste (file/d/{ID}/view, open?id={ID}, uc?id={ID},
 *      lh3.googleusercontent.com/d/{ID}, docs.google.com/uc?id={ID}).
 *   2. "Shared publicly" — we run a HEAD request against the direct-view
 *      URL and bucket the verdict into public / private / unknown.
 *
 * Using a HEAD probe (not the Drive API) is a deliberate trade-off — no
 * service-account setup needed, the probe behaves exactly like the
 * eventual published-article reader (an anonymous browser fetching the
 * image), and it costs zero quota. When the publisher pipeline graduates
 * to fetching binaries for upload to WordPress media we'll add a real
 * Drive API path; today's verdict is enough for the editorial gate.
 */
@Injectable()
export class DriveService {
  private readonly logger = new ArticleParserLogger(DriveService.name);

  /** Compiled patterns for the canonical Drive URL shapes we accept. */
  private readonly FILE_ID_PATTERNS: RegExp[] = [
    // https://drive.google.com/file/d/{ID}/view
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{15,})/,
    // https://drive.google.com/open?id={ID}
    /drive\.google\.com\/open\?(?:[^&]*&)*id=([a-zA-Z0-9_-]{15,})/,
    // https://drive.google.com/uc?id={ID} (with or without export=)
    /drive\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]{15,})/,
    // https://docs.google.com/uc?id={ID}
    /docs\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]{15,})/,
    // https://lh3.googleusercontent.com/d/{ID}
    /lh\d?\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{15,})/,
  ];

  /**
   * Extract a Drive file ID from any URL the writer might paste.
   * Returns `null` if the URL isn't a recognised Drive URL.
   */
  extractFileId(url: string): string | null {
    if (!url) return null;
    for (const pattern of this.FILE_ID_PATTERNS) {
      const m = pattern.exec(url);
      if (m?.[1]) return m[1];
    }
    return null;
  }

  /**
   * Build the canonical direct-view URL given a file id. This is the URL
   * we'd embed in the WordPress `<img src="...">` when publishing — and
   * the URL we HEAD-probe to verify public accessibility.
   */
  buildDirectViewUrl(fileId: string): string {
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  /**
   * HEAD-probe an image URL to see if it's publicly fetchable.
   *
   * Drive's "anyone with link can view" behaviour:
   *   - Public: 200 OK (often with a 302 redirect to a googleusercontent CDN)
   *   - Private: 401 / 403, OR 200 with HTML content (login page)
   *   - Deleted / wrong ID: 404
   *
   * Network errors / unexpected statuses bucket into 'unknown' so the
   * quality gate can downgrade rather than reject outright (fail-open
   * semantics matching Sourcerer-Be's AI-validity service).
   */
  async checkDrivePermission(
    url: string,
    timeoutMs = 5000,
  ): Promise<DriveImageInfo> {
    const fileId = this.extractFileId(url);

    if (!fileId) {
      return {
        rawUrl: url,
        fileId: null,
        directViewUrl: null,
        permission: 'not-drive',
      };
    }

    const directViewUrl = this.buildDirectViewUrl(fileId);

    try {
      const response = await axios.head(directViewUrl, {
        timeout: timeoutMs,
        maxRedirects: 5,
        validateStatus: () => true,
      });

      const status = response.status;
      const contentType = String(
        response.headers['content-type'] ?? '',
      ).toLowerCase();

      // 200 OK with image content-type → publicly fetchable image
      if (status === 200 && contentType.startsWith('image/')) {
        return {
          rawUrl: url,
          fileId,
          directViewUrl,
          permission: 'public',
          status,
        };
      }

      // 200 OK with text/html → Drive's "you need to sign in" login page,
      // i.e. the file is private behind an SSO redirect that resolved 200
      if (status === 200 && contentType.startsWith('text/html')) {
        return {
          rawUrl: url,
          fileId,
          directViewUrl,
          permission: 'private',
          status,
        };
      }

      // 401 / 403 are the canonical "private" signal
      if (status === 401 || status === 403) {
        return {
          rawUrl: url,
          fileId,
          directViewUrl,
          permission: 'private',
          status,
        };
      }

      // 404 — file doesn't exist or was deleted
      if (status === 404) {
        return {
          rawUrl: url,
          fileId,
          directViewUrl,
          permission: 'unknown',
          status,
        };
      }

      // Anything else (3xx without follow, weird statuses) → unknown
      return {
        rawUrl: url,
        fileId,
        directViewUrl,
        permission: 'unknown',
        status,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      this.logger.debug(
        `Drive HEAD probe failed for ${directViewUrl}: ${axiosErr.code ?? axiosErr.message}`,
      );
      return {
        rawUrl: url,
        fileId,
        directViewUrl,
        permission: 'unknown',
      };
    }
  }

  /**
   * Batch the HEAD probe with a concurrency cap so a dense article
   * doesn't burst Google with 20 simultaneous requests.
   */
  async checkBatch(
    urls: string[],
    concurrency = 4,
    timeoutMs = 5000,
  ): Promise<DriveImageInfo[]> {
    const results: DriveImageInfo[] = new Array(urls.length);
    let cursor = 0;

    const workers = Array.from(
      { length: Math.min(concurrency, urls.length) },
      async () => {
        while (cursor < urls.length) {
          const idx = cursor++;
          results[idx] = await this.checkDrivePermission(urls[idx], timeoutMs);
        }
      },
    );

    await Promise.all(workers);
    return results;
  }
}
