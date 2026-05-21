import { QualityGateConfig } from './types';

/**
 * Build a config from env vars. Mirrors Sourcerer-Be's pattern of
 * env-tunable thresholds (`EVENT_VALIDITY_*`) — runtime overrides via
 * AppConfigModule layer on top in a later step.
 */
export function loadConfigFromEnv(): QualityGateConfig {
  const num = (key: string, fallback: number): number => {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    acceptThreshold: num('QUALITY_ACCEPT_THRESHOLD', 3),
    rejectThreshold: num('QUALITY_REJECT_THRESHOLD', -6),
    minImages: num('QUALITY_MIN_IMAGES', 2),
    maxImages: num('QUALITY_MAX_IMAGES', 8),
    minProductLinks: num('QUALITY_MIN_PRODUCT_LINKS', 2),
    maxProductLinks: num('QUALITY_MAX_PRODUCT_LINKS', 10),
    ruleWeights: {},
  };
}

/**
 * Apply per-rule weight overrides (from AppConfig or env). The rule
 * lookup is `cfg.ruleWeights[name] ?? defaultWeight` so unset names
 * keep the rule's default.
 */
export function weightFor(
  cfg: QualityGateConfig,
  name: string,
  defaultWeight: number,
): number {
  const override = cfg.ruleWeights[name];
  return typeof override === 'number' ? override : defaultWeight;
}
