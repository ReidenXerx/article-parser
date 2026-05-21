import { weightFor } from '../quality-gate.config';
import { Rule } from '../types';

/**
 * FORMATTING rules — direct mapping of the brief's fourth common mistake:
 *   "Basic formatting of the article"
 *
 * + the WordPress-upload requirements (meta title / meta description
 * must be present and within sane lengths).
 *
 * Heading hierarchy is checked by walking the outline once and counting
 * "level skipped" transitions (H2 → H4 without H3 = 1 skip).
 */

export const formattingRules: Rule[] = [
  // ── H1 discipline ──────────────────────────────────────────────────
  //
  // Exactly one H1 is the universal SEO rule. The sample document has 2
  // (the Conclusion section was wrongly styled) — perfect demo trigger.

  ({ article }, cfg) => {
    if (article.formatting.h1Count === 0) {
      return [
        {
          name: 'fmt.missingH1',
          weight: weightFor(cfg, 'fmt.missingH1', -3),
          matched: 'no H1 found in article body',
        },
      ];
    }
    if (article.formatting.h1Count > 1) {
      return [
        {
          name: 'fmt.multipleH1',
          weight: weightFor(cfg, 'fmt.multipleH1', -2),
          matched: `${article.formatting.h1Count} H1 headings (should be exactly 1)`,
        },
      ];
    }
    return [
      {
        name: 'fmt.singleH1',
        weight: weightFor(cfg, 'fmt.singleH1', 1),
        matched: '1 H1 heading',
      },
    ];
  },

  // ── Heading hierarchy ──────────────────────────────────────────────

  ({ article }, cfg) => {
    let skips = 0;
    let prev = 0;
    for (const h of article.formatting.headingOutline) {
      if (prev > 0 && h.level > prev + 1) skips += 1;
      prev = h.level;
    }
    if (skips === 0) return [];
    return [
      {
        name: 'fmt.headingLevelSkip',
        weight: weightFor(cfg, 'fmt.headingLevelSkip', -1),
        matched: `${skips} heading level skip(s) (e.g. H2 → H4)`,
      },
    ];
  },

  // ── Meta-field presence ────────────────────────────────────────────
  //
  // These are explicit WordPress-upload requirements in the brief, so
  // missing meta fields land hefty negative weights — they'll usually
  // push the article straight to 'reject' on their own.

  ({ article }, cfg) => {
    if (!article.meta.metaTitle) {
      return [
        {
          name: 'fmt.missingMetaTitle',
          weight: weightFor(cfg, 'fmt.missingMetaTitle', -4),
          matched: 'no Meta Title annotation found',
        },
      ];
    }
    const len = article.meta.metaTitle.length;
    if (len > 70) {
      return [
        {
          name: 'fmt.metaTitleTooLong',
          weight: weightFor(cfg, 'fmt.metaTitleTooLong', -1),
          matched: `Meta Title is ${len} chars (recommended ≤ 60)`,
        },
      ];
    }
    return [
      {
        name: 'fmt.metaTitleOk',
        weight: weightFor(cfg, 'fmt.metaTitleOk', 1),
        matched: `Meta Title present (${len} chars)`,
      },
    ];
  },

  ({ article }, cfg) => {
    if (!article.meta.metaDescription) {
      return [
        {
          name: 'fmt.missingMetaDescription',
          weight: weightFor(cfg, 'fmt.missingMetaDescription', -4),
          matched: 'no Meta Description annotation found',
        },
      ];
    }
    const len = article.meta.metaDescription.length;
    if (len > 170) {
      return [
        {
          name: 'fmt.metaDescTooLong',
          weight: weightFor(cfg, 'fmt.metaDescTooLong', -1),
          matched: `Meta Description is ${len} chars (recommended ≤ 155)`,
        },
      ];
    }
    if (len < 70) {
      return [
        {
          name: 'fmt.metaDescTooShort',
          weight: weightFor(cfg, 'fmt.metaDescTooShort', -1),
          matched: `Meta Description is ${len} chars (recommended ≥ 70)`,
        },
      ];
    }
    return [
      {
        name: 'fmt.metaDescOk',
        weight: weightFor(cfg, 'fmt.metaDescOk', 1),
        matched: `Meta Description present (${len} chars)`,
      },
    ];
  },

  // ── Content density / scannability ─────────────────────────────────

  ({ article }, cfg) => {
    if (article.formatting.maxParagraphChars > 1000) {
      return [
        {
          name: 'fmt.paragraphWall',
          weight: weightFor(cfg, 'fmt.paragraphWall', -2),
          matched: `longest paragraph is ${article.formatting.maxParagraphChars} chars (>1000)`,
        },
      ];
    }
    return [];
  },

  ({ article }, cfg) => {
    if (article.formatting.wordCount < 300) {
      return [
        {
          name: 'fmt.thinContent',
          weight: weightFor(cfg, 'fmt.thinContent', -2),
          matched: `only ${article.formatting.wordCount} words (recommended ≥ 300)`,
        },
      ];
    }
    return [];
  },
];
