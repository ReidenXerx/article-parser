import { formattingRules } from './rules/formatting.rules';
import { imageRules } from './rules/image.rules';
import { linkRules } from './rules/link.rules';
import {
  AssessmentInput,
  DeterministicVerdict,
  QualityGateConfig,
  Rule,
  RuleHit,
} from './types';

/**
 * Deterministic article quality scorer.
 *
 * Direct port of Sourcerer-Be's `assessEventValidity()` pattern:
 *   - run every rule, collect their hits
 *   - sum weights (each hit's `weight` field is a signed integer)
 *   - bucket into accept / reject / escalate using configurable thresholds
 *   - return the full hit list alongside the verdict so the decision log
 *     line is self-documenting (`score=-3 → escalate | rules: -image.tooFew(-4), +image.altCoverageFull(+1)`)
 *
 * Rules are pure functions of `(input, cfg)` — they don't make HTTP /
 * DB calls, which keeps the scorer fully unit-testable in isolation.
 */

const ALL_RULES: Rule[] = [...imageRules, ...linkRules, ...formattingRules];

export function assessArticleQuality(
  input: AssessmentInput,
  cfg: QualityGateConfig,
): DeterministicVerdict {
  const rules: RuleHit[] = [];

  for (const rule of ALL_RULES) {
    const hits = rule(input, cfg);
    if (hits.length > 0) rules.push(...hits);
  }

  const score = rules.reduce((acc, r) => acc + r.weight, 0);

  let decision: DeterministicVerdict['decision'];
  if (score >= cfg.acceptThreshold) {
    decision = 'accept';
  } else if (score <= cfg.rejectThreshold) {
    decision = 'reject';
  } else {
    decision = 'escalate';
  }

  return { decision, score, rules };
}

/**
 * Format a deterministic verdict as the single-line summary written to
 * `decisions.log`. Mirrors `formatVerdict()` in `event-validity.util.ts`.
 */
export function formatDeterministicVerdict(v: DeterministicVerdict): string {
  const sign = v.score >= 0 ? '+' : '';
  const ruleStr = v.rules
    .map(
      (r) =>
        `${r.weight > 0 ? '+' : ''}${r.name}(${r.weight > 0 ? '+' : ''}${r.weight})`,
    )
    .join(', ');
  return `score=${sign}${v.score} → ${v.decision} | rules: ${ruleStr || '(none triggered)'}`;
}
