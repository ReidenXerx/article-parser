import { weightFor } from '../quality-gate.config';
import { Rule } from '../types';

/**
 * Link-reachability rules.
 *
 * The brief's "make sure product links go to correct pages" requirement
 * splits into three failure modes the LinkValidationService labels for
 * us. Each fires as ONE aggregated hit per article (not per link) so a
 * 14-link article with two hard 404s doesn't collapse the score by -6
 * on the same rule.
 *
 * Weights chosen to mirror the image rules:
 *   - Confirmed broken (hard 4xx OR soft 404) = -4 baseline, same
 *     severity as `image.drivePrivate`. A reader hitting a broken
 *     product link is the same kind of visible failure as a broken
 *     image — and worse for SEO because Google crawls these.
 *   - Server errors (5xx) and network errors get lighter weights
 *     because they're often transient and editors shouldn't be
 *     blocked on them.
 */

export const linkReachabilityRules: Rule[] = [
  // ── Hard 4xx — server confirmed the URL doesn't exist ──────────────
  ({ article }, cfg) => {
    const broken = article.links.filter(
      (l) => l.validation?.status === 'hard-4xx',
    );
    if (broken.length === 0) return [];
    return [
      {
        name: 'links.hard4xx',
        weight: weightFor(cfg, 'links.hard4xx', -4),
        matched: `${broken.length} link(s) returned 4xx${
          broken[0]?.validation?.httpStatus
            ? ` (e.g. ${broken[0].validation.httpStatus} for ${broken[0].href.slice(0, 60)})`
            : ''
        }`,
      },
    ];
  },

  // ── Soft 404 — 200 OK but page is a "not found" template ───────────
  ({ article }, cfg) => {
    const soft = article.links.filter(
      (l) => l.validation?.status === 'soft-404',
    );
    if (soft.length === 0) return [];
    return [
      {
        name: 'links.soft404',
        weight: weightFor(cfg, 'links.soft404', -4),
        matched: `${soft.length} link(s) land on a 404 template (e.g. ${soft[0]?.validation?.detail ?? ''})`,
      },
    ];
  },

  // ── 5xx — server-side error, may be transient ──────────────────────
  ({ article }, cfg) => {
    const errs = article.links.filter(
      (l) => l.validation?.status === 'hard-5xx',
    );
    if (errs.length === 0) return [];
    return [
      {
        name: 'links.hard5xx',
        weight: weightFor(cfg, 'links.hard5xx', -1),
        matched: `${errs.length} link(s) returned 5xx (server-side; may be transient)`,
      },
    ];
  },

  // ── Unreachable — DNS / network error ──────────────────────────────
  ({ article }, cfg) => {
    const unreachable = article.links.filter(
      (l) => l.validation?.status === 'unreachable',
    );
    if (unreachable.length === 0) return [];
    return [
      {
        name: 'links.unreachable',
        weight: weightFor(cfg, 'links.unreachable', -1),
        matched: `${unreachable.length} link(s) unreachable (network error)`,
      },
    ];
  },

  // ── All-OK bonus when we actually ran the validator ────────────────
  ({ article }, cfg) => {
    const validated = article.links.filter(
      (l) =>
        l.validation &&
        l.validation.status !== 'skipped' &&
        l.validation.status !== 'redirect',
    );
    if (validated.length === 0) return [];
    const broken = validated.filter(
      (l) =>
        l.validation!.status === 'hard-4xx' ||
        l.validation!.status === 'soft-404' ||
        l.validation!.status === 'hard-5xx' ||
        l.validation!.status === 'unreachable',
    );
    if (broken.length > 0) return [];
    return [
      {
        name: 'links.allReachable',
        weight: weightFor(cfg, 'links.allReachable', 1),
        matched: `all ${validated.length} probed link(s) returned OK`,
      },
    ];
  },
];
