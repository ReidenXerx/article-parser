import { ExtractedArticle } from '../extractors/extracted-article.types';

/**
 * Inputs every rule needs.
 *
 * Rules read from the fully-extracted article + the live config — they
 * don't make their own HTTP / DB calls. This keeps the rule layer pure
 * and unit-testable in isolation.
 */
export interface AssessmentInput {
  article: ExtractedArticle;
}

/**
 * Tunable thresholds + per-rule weights for the article quality gate.
 *
 * Mirrors Sourcerer-Be's `VALIDITY_ACCEPT_THRESHOLD` / `VALIDITY_REJECT_THRESHOLD`
 * pattern. Loaded from env at startup; the AppConfigModule will let an
 * editor override at runtime without restart in a later step.
 */
export interface QualityGateConfig {
  acceptThreshold: number;
  rejectThreshold: number;

  // Image count bounds
  minImages: number;
  maxImages: number;

  // Product link bounds
  minProductLinks: number;
  maxProductLinks: number;

  // Per-rule weight overrides — when present, the rule uses this value
  // instead of its hard-coded default. Lets the editor team tune
  // strictness without changing code.
  ruleWeights: Record<string, number>;
}

export interface RuleHit {
  /** Unique slug like `image.notHostedOnDrive` — written verbatim to the
   *  decision log so the editor can grep for it. */
  name: string;
  /** Signed integer. Positive = quality signal, negative = problem. */
  weight: number;
  /** Short human-readable snippet of what triggered the rule. Shown in
   *  the audit panel UI. */
  matched: string;
}

export type Rule = (
  input: AssessmentInput,
  cfg: QualityGateConfig,
) => RuleHit[];

export type ValidityDecision = 'accept' | 'reject' | 'escalate';

export interface DeterministicVerdict {
  decision: ValidityDecision;
  score: number;
  rules: RuleHit[];
}

export interface AiVerdict {
  verdict: 'accept' | 'reject';
  reasoning: string;
}

export interface QualityReport {
  /** Final decision after the optional AI second-opinion. */
  finalDecision: ValidityDecision;
  /** Deterministic scorer output — always present. */
  deterministic: DeterministicVerdict;
  /** AI second-opinion output — only present when the deterministic
   *  verdict was 'escalate'. */
  ai?: AiVerdict;
}
