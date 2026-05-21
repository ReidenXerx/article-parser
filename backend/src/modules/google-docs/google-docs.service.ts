import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { existsSync } from 'fs';
import { google } from 'googleapis';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';

export type GoogleDocsFetchMode = 'public-export' | 'docs-api';

export interface FetchedDoc {
  docId: string;
  sourceUrl: string;
  html: string;
  mode: GoogleDocsFetchMode;
}

/**
 * Cascading Google Doc HTML fetcher.
 *
 * Mirrors Sourcerer-Be's "cheap-then-fall-back" extraction strategy:
 *
 *   1. Try the public export endpoint
 *        https://docs.google.com/document/d/{id}/export?format=html
 *      Works for any doc with link sharing set to "Anyone with the link
 *      can view" (the default for editorial workflows). Zero auth setup,
 *      zero quota.
 *
 *   2. If that returns a Google login page (HTTP 200 with HTML containing
 *      "ServiceLogin", OR a 4xx), fall back to Drive's authenticated
 *      `files.export` with a service-account key. Same HTML output shape,
 *      just behind OAuth — used when the writer kept the doc private.
 *
 * Either way the result is a single HTML string ready to feed into the
 * extractor pipeline. The decision log records which path was taken so
 * the editor can spot "your doc is private, the system fell back to API
 * mode" warnings.
 */
@Injectable()
export class GoogleDocsService {
  private readonly logger = new ArticleParserLogger(GoogleDocsService.name);

  /** Recognised URL shapes for the doc body. */
  private readonly DOC_ID_PATTERNS: RegExp[] = [
    // https://docs.google.com/document/d/{ID}/edit?...
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{20,})/,
    // Just the ID itself (CLI / API callers)
    /^([a-zA-Z0-9_-]{20,})$/,
  ];

  extractDocId(urlOrId: string): string | null {
    if (!urlOrId) return null;
    for (const pattern of this.DOC_ID_PATTERNS) {
      const m = pattern.exec(urlOrId.trim());
      if (m?.[1]) return m[1];
    }
    return null;
  }

  async fetch(urlOrId: string): Promise<FetchedDoc> {
    const docId = this.extractDocId(urlOrId);
    if (!docId) {
      throw new Error(
        `Could not extract a Google Doc ID from "${urlOrId}". Expected a docs.google.com/document/d/{ID}/edit URL or a bare ID.`,
      );
    }

    this.logger.decide('DOC-FETCH', urlOrId, `docId=${docId}`);

    // 1. Try the public export endpoint
    const publicResult = await this.tryPublicExport(docId);
    if (publicResult) {
      this.logger.decide(
        'DOC-FORMAT',
        `docId=${docId}`,
        `mode=public-export, htmlBytes=${publicResult.length}`,
      );
      return {
        docId,
        sourceUrl: urlOrId,
        html: publicResult,
        mode: 'public-export',
      };
    }

    // 2. Fall back to authenticated Drive API export
    this.logger.decide(
      'DOC-FORMAT',
      `docId=${docId}`,
      'public-export failed, falling back to Drive API',
    );

    const apiResult = await this.tryDocsApiExport(docId);
    if (apiResult) {
      this.logger.decide(
        'DOC-FORMAT',
        `docId=${docId}`,
        `mode=docs-api, htmlBytes=${apiResult.length}`,
      );
      return {
        docId,
        sourceUrl: urlOrId,
        html: apiResult,
        mode: 'docs-api',
      };
    }

    throw new Error(
      `Could not fetch doc ${docId}. Public export returned a login page and Drive API is not configured (set GOOGLE_SERVICE_ACCOUNT_KEY_FILE).`,
    );
  }

  private async tryPublicExport(docId: string): Promise<string | null> {
    const url = `https://docs.google.com/document/d/${docId}/export?format=html`;
    try {
      const response = await axios.get<string>(url, {
        timeout: 15_000,
        responseType: 'text',
        // Google sometimes redirects through /accounts/ServiceLogin for
        // private docs — we want to see those redirects, not follow them.
        maxRedirects: 5,
        validateStatus: () => true,
      });

      if (response.status !== 200) {
        this.logger.debug(
          `Public export returned ${response.status} for ${docId}`,
        );
        return null;
      }

      const body = response.data;
      // Heuristic: a Google sign-in page is HTML containing "ServiceLogin"
      // or the canonical "Sign in - Google Accounts" title. Real doc HTML
      // doesn't contain either.
      if (
        typeof body === 'string' &&
        (body.includes('ServiceLogin') ||
          body.includes('accounts.google.com'))
      ) {
        this.logger.debug(
          `Public export for ${docId} returned a login page — doc is private`,
        );
        return null;
      }

      // Dump raw fetched HTML as an artifact for post-mortem
      void this.logger.artifact(
        'gdocs',
        docId.slice(0, 12),
        'raw',
        typeof body === 'string' ? body : String(body),
        'html',
      );

      return body;
    } catch (err) {
      this.logger.debug(
        `Public export request failed for ${docId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async tryDocsApiExport(docId: string): Promise<string | null> {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    if (!keyFile) {
      this.logger.debug(
        'GOOGLE_SERVICE_ACCOUNT_KEY_FILE not set — skipping Drive API fallback',
      );
      return null;
    }
    if (!existsSync(keyFile)) {
      this.logger.warn(
        `GOOGLE_SERVICE_ACCOUNT_KEY_FILE points to ${keyFile}, but the file does not exist`,
      );
      return null;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/documents.readonly',
        ],
      });

      const drive = google.drive({ version: 'v3', auth });
      const response = await drive.files.export(
        { fileId: docId, mimeType: 'text/html' },
        { responseType: 'text' },
      );

      const html = response.data as unknown as string;

      void this.logger.artifact(
        'gdocs-api',
        docId.slice(0, 12),
        'raw',
        html,
        'html',
      );

      return html;
    } catch (err) {
      this.logger.error(
        `Drive API export failed for ${docId}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
