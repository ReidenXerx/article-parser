/**
 * Canonical shape of an extracted article inside the system. Every
 * extractor populates one slice of this and the orchestrator merges them.
 *
 * The QualityGate reads from this shape (not raw HTML) so rules stay
 * portable — swapping the underlying ingestion source (Google Docs ↔
 * Notion ↔ markdown file) doesn't require touching the rule layer.
 */

export interface ExtractedMetaFields {
  /** First H1 in the body — what reads as the article title. */
  articleTitle: string;
  /** Yoast-style "Meta Title:" inline annotation, if present. */
  metaTitle: string | null;
  /** Yoast-style "Meta Description:" inline annotation, if present. */
  metaDescription: string | null;
  /** Source of each field, for the audit panel. */
  source: {
    articleTitle: 'h1' | 'ai-fallback' | 'missing';
    metaTitle: 'regex' | 'ai-fallback' | 'missing';
    metaDescription: 'regex' | 'ai-fallback' | 'missing';
  };
}

export interface ExtractedImage {
  /** Where in the article body this image sits (rough char offset). */
  position: number;
  /** Raw URL the writer used (may be Drive, googleusercontent, or external). */
  rawUrl: string;
  /** Alt text — from img.alt for embedded, or "Alt tag:" annotation for placeholders. */
  altText: string;
  /** Classification of how this image is represented in the source doc. */
  kind: 'embedded' | 'placeholder-link';
  /** Surrounding section/paragraph text — for the relevance vision check. */
  surroundingText?: string;
  /** Drive details, populated by the Drive check pass when applicable. */
  drive?: {
    fileId: string | null;
    directViewUrl: string | null;
    permission: 'public' | 'private' | 'not-drive' | 'unknown';
    status?: number;
  };
}

export interface ExtractedLink {
  position: number;
  href: string;
  /** Anchor text, normalised (whitespace collapsed). */
  anchorText: string;
  /** Classification per host + path heuristics. */
  classification:
    | 'product' // points at a product/collection page on the client domain
    | 'brand' // homepage of the client domain
    | 'internal' // any other link on the client domain
    | 'external' // off-domain link
    | 'image-placeholder'; // "IMAGE N" Drive placeholder
}

export interface ExtractedFormattingAudit {
  h1Count: number;
  /** Sequence of (level, text) — used for hierarchy checks ("H4 after H2 without H3"). */
  headingOutline: Array<{ level: 1 | 2 | 3 | 4 | 5 | 6; text: string }>;
  paragraphCount: number;
  /** Longest paragraph length, in characters. */
  maxParagraphChars: number;
  /** Total word count of the body. */
  wordCount: number;
  /** Embedded images that have no alt text. */
  imagesMissingAlt: number;
}

export interface ExtractedBodyHtml {
  /** WordPress-clean HTML, ready to POST to the REST API. */
  cleanHtml: string;
  /** Raw HTML kept side-by-side for diffing in the UI. */
  rawHtml: string;
  /** Bytes saved by the sanitization pass — surfaced in the audit panel. */
  bytesStripped: number;
}

/**
 * Fully extracted article, as it lands on the QualityGate's desk.
 */
export interface ExtractedArticle {
  sourceUrl: string;
  docId: string;
  meta: ExtractedMetaFields;
  body: ExtractedBodyHtml;
  images: ExtractedImage[];
  links: ExtractedLink[];
  formatting: ExtractedFormattingAudit;
}
