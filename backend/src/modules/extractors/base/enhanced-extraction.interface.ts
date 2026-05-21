import { AIUsageMetrics } from '../../openai/types/usage.types';

/**
 * Context passed to every extractor.
 *
 * Mirrors Sourcerer-Be's `ExtractionContext` — narrow fields that affect
 * how an extractor behaves, not the full pipeline state. Extractors
 * SHOULD NOT need to know each other's outputs (one-way data flow into
 * the orchestrator).
 */
export interface ExtractionContext {
  /** The original doc URL the editor pasted. Used for log breadcrumbs. */
  sourceUrl?: string;
  /** The Google Doc id, if known. */
  docId?: string;
  /** Override the OpenAI model for this extractor only (cost tuning). */
  modelOverride?: string;
}

export interface UsageTrackedExtractionResult<T> {
  data: T;
  /** Optional confidence score 0-1 — exposed in the audit panel UI. */
  confidence?: number;
  usage: AIUsageMetrics;
}

/**
 * Every focused extractor in the system implements this. Returning usage
 * alongside data lets the orchestrator sum per-article cost without
 * re-running the pricing table.
 */
export interface EnhancedExtractionModule<T> {
  /** Identifier shown in the per-article cost summary `byModule`. */
  readonly name: string;

  extractWithUsage(
    content: string,
    context?: ExtractionContext,
  ): Promise<UsageTrackedExtractionResult<T>>;
}

/** Empty usage marker returned by fully-deterministic extractors. */
export function createEmptyUsage(): AIUsageMetrics {
  return {
    model: 'deterministic',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
  };
}

export function createEnhancedResult<T>(
  data: T,
  confidence: number,
  usage: AIUsageMetrics,
): UsageTrackedExtractionResult<T> {
  return { data, confidence, usage };
}
