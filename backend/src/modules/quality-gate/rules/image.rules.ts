import { weightFor } from '../quality-gate.config';
import { Rule, RuleHit } from '../types';

/**
 * IMAGE rules — direct mapping of the brief's "common mistakes":
 *   1. "Articles have too many, or not enough images"
 *   2. "Images aren't hosted on Google Drive, or aren't shared publicly"
 *
 * Each rule contributes at most ONE hit to the score — the rule layer
 * is summable and idempotent. Image-level findings (per-image alt/Drive
 * issues) surface aggregated counts so the score doesn't explode on a
 * 20-image article where 15 happen to fail one check.
 */

export const imageRules: Rule[] = [
  // ── Count bands ─────────────────────────────────────────────────────

  ({ article }, cfg) => {
    const count = article.images.length;
    if (count < cfg.minImages) {
      return [
        {
          name: 'image.tooFew',
          weight: weightFor(cfg, 'image.tooFew', -4),
          matched: `${count} images (min: ${cfg.minImages})`,
        },
      ];
    }
    if (count > cfg.maxImages) {
      return [
        {
          name: 'image.tooMany',
          weight: weightFor(cfg, 'image.tooMany', -2),
          matched: `${count} images (max: ${cfg.maxImages})`,
        },
      ];
    }
    return [
      {
        name: 'image.healthyCount',
        weight: weightFor(cfg, 'image.healthyCount', 1),
        matched: `${count} images (band: ${cfg.minImages}-${cfg.maxImages})`,
      },
    ];
  },

  // ── Drive hosting ──────────────────────────────────────────────────
  //
  // The brief is explicit: images must be hosted on Google Drive. We
  // count any image whose URL isn't recognisably Drive (or its
  // googleusercontent CDN) as a violation. One aggregated hit per
  // article keeps the score from collapsing on a 6-image article with
  // 5 non-Drive embeds (a single -3 already escalates that case).
  ({ article }, cfg) => {
    if (article.images.length === 0) return [];
    const nonDrive = article.images.filter(
      (img) => img.drive && img.drive.permission === 'not-drive',
    );
    if (nonDrive.length === 0) return [];
    return [
      {
        name: 'image.notHostedOnDrive',
        weight: weightFor(cfg, 'image.notHostedOnDrive', -3),
        matched: `${nonDrive.length} of ${article.images.length} images not on Drive`,
      },
    ];
  },

  // ── Drive sharing ──────────────────────────────────────────────────
  //
  // Heavily weighted because a private Drive image silently 404s when
  // the article is published — readers see a broken thumbnail and the
  // SEO impact is real. Aggregated count, one hit per article.
  ({ article }, cfg) => {
    const privateImages = article.images.filter(
      (img) => img.drive?.permission === 'private',
    );
    if (privateImages.length === 0) return [];
    return [
      {
        name: 'image.drivePrivate',
        weight: weightFor(cfg, 'image.drivePrivate', -4),
        matched: `${privateImages.length} Drive image(s) not publicly accessible`,
      },
    ];
  },

  ({ article }, cfg) => {
    const unknownPerms = article.images.filter(
      (img) => img.drive?.permission === 'unknown',
    );
    if (unknownPerms.length === 0) return [];
    return [
      {
        name: 'image.drivePermUnknown',
        weight: weightFor(cfg, 'image.drivePermUnknown', -1),
        matched: `${unknownPerms.length} image(s) failed accessibility probe`,
      },
    ];
  },

  // ── Alt-text coverage (accessibility + SEO) ────────────────────────

  ({ article }, cfg): RuleHit[] => {
    if (article.images.length === 0) return [];
    const missingAlt = article.images.filter(
      (img) => !img.altText || img.altText.trim().length === 0,
    );
    if (missingAlt.length === 0) {
      return [
        {
          name: 'image.altCoverageFull',
          weight: weightFor(cfg, 'image.altCoverageFull', 1),
          matched: `all ${article.images.length} images have alt text`,
        },
      ];
    }
    return [
      {
        name: 'image.missingAlt',
        weight: weightFor(cfg, 'image.missingAlt', -2),
        matched: `${missingAlt.length} of ${article.images.length} images missing alt text`,
      },
    ];
  },
];
