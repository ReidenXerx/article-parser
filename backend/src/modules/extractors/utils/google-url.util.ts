/**
 * Google Docs's HTML export wraps every external link in a redirect:
 *     <a href="https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpath&sa=D&...">
 *
 * Both the body-html sanitizer (so the published article doesn't ship
 * Google redirect URLs) and the link-inventory classifier (so links
 * classify by their TRUE destination host, not www.google.com) need to
 * undo the wrap. Centralising the unwrap here keeps both call sites
 * deterministic and identically permissive.
 */
export function unwrapGoogleRedirect(href: string): string {
  if (!href) return href;
  const match = /^https?:\/\/(?:www\.)?google\.com\/url\?(?:[^&]*&)*q=([^&]+)/.exec(
    href,
  );
  if (!match?.[1]) return href;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return href;
  }
}
