import { JSDOM } from 'jsdom';

/**
 * Build a JSDOM window for a fragment of Google Docs export HTML.
 *
 * Google's export wraps content in `<html><head>...</head><body><p>...</p></body></html>`.
 * Some callers want only the body. We expose both shapes so each extractor
 * can pick what it needs without re-parsing.
 */
export function parseHtml(html: string): {
  dom: JSDOM;
  document: Document;
  body: HTMLElement;
} {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const body = document.body;
  return { dom, document, body };
}

/** Collapse whitespace and trim — used everywhere we read text content. */
export function normaliseText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Walk every element in document order, yielding HTMLElement nodes only.
 * Used by inventory extractors to compute reasonable position offsets
 * for ordering / surrounding-text retrieval.
 */
export function* walkElements(root: HTMLElement): Generator<HTMLElement> {
  // The TreeWalker API on jsdom's Document — much faster than recursion
  // and correctly skips comment / text nodes.
  const walker = root.ownerDocument!.createTreeWalker(
    root,
    1, // NodeFilter.SHOW_ELEMENT
  );
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node !== root) yield node as HTMLElement;
    node = walker.nextNode();
  }
}

/**
 * Return the rough character offset of `el.textContent` within
 * `root.textContent`. Used to order findings (images, links) in the
 * audit panel by their position in the article body.
 */
export function characterOffset(root: HTMLElement, el: HTMLElement): number {
  const rootText = root.textContent ?? '';
  const elText = el.textContent ?? '';
  if (!elText) return 0;
  // indexOf is cheap and stable enough; we only need ordering, not
  // pixel-accurate offsets.
  return Math.max(0, rootText.indexOf(elText));
}

/**
 * Return the nearest section/paragraph text surrounding an element.
 * Walks up to the closest `<p>`, `<h1..h6>`, or `<li>` ancestor (or the
 * direct parent if none of those exist) and returns its text.
 */
export function surroundingText(el: HTMLElement, maxChars = 400): string {
  const container = el.closest('p,h1,h2,h3,h4,h5,h6,li') ?? el.parentElement;
  if (!container) return '';
  return normaliseText(container.textContent ?? '').slice(0, maxChars);
}
