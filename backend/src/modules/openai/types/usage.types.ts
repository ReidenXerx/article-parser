/**
 * Standard usage shape every AI-powered service in the system returns
 * alongside its data. Mirrors Sourcerer-Be's `AIUsageMetrics`.
 *
 * Carrying `cost` here (not just tokens) means the decision logger can
 * sum per-article cost without re-running the pricing table.
 */
export interface AIUsageMetrics {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD, rounded to 6 decimal places. */
  cost: number;
}

/**
 * Wrapper around an extractor / classifier result + the AI usage it cost
 * to compute. `T` is whatever the caller wants (parsed JSON, a string,
 * etc.).
 */
export interface EnhancedAIResponse<T> {
  data: T;
  usage: AIUsageMetrics;
}
