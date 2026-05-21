import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { AIUsageMetrics } from './types/usage.types';

interface ModelPricing {
  /** USD per 1K input tokens. */
  input: number;
  /** USD per 1K output tokens. */
  output: number;
}

/**
 * Per-model pricing + cost aggregation, ported from Sourcerer-Be.
 *
 * Pricing as of 2026-05. Update here when OpenAI moves prices — the rest
 * of the codebase reads cost exclusively through this service so a price
 * change is a one-file diff.
 */
@Injectable()
export class TokenCostCalculatorService {
  private readonly logger = new ArticleParserLogger(
    TokenCostCalculatorService.name,
  );

  private readonly MODEL_PRICING: Record<string, ModelPricing> = {
    // GPT-5 series (reasoning models)
    'gpt-5': { input: 0.015, output: 0.06 },
    'gpt-5-mini': { input: 0.0004, output: 0.0016 },
    'gpt-5-nano': { input: 0.0001, output: 0.0004 },
    // GPT-5.4 series (legacy reasoning models still common in Sourcerer-Be)
    'gpt-5.4-mini': { input: 0.0004, output: 0.0016 },
    'gpt-5.4-nano': { input: 0.0001, output: 0.0004 },
    // GPT-4o series (widely available, sane default)
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    // Vision variants
    'gpt-4o-vision': { input: 0.0025, output: 0.01 },
  };

  calculateCost(
    promptTokens: number,
    completionTokens: number,
    model: string,
  ): number {
    const pricing = this.MODEL_PRICING[model];

    if (!pricing) {
      this.logger.warn(
        `Unknown model pricing for: ${model}, using gpt-5-mini pricing`,
      );
      return this.computeCost(
        promptTokens,
        completionTokens,
        this.MODEL_PRICING['gpt-5-mini'],
      );
    }

    return this.computeCost(promptTokens, completionTokens, pricing);
  }

  createUsageMetrics(
    promptTokens: number,
    completionTokens: number,
    model: string,
  ): AIUsageMetrics {
    const totalTokens = promptTokens + completionTokens;
    const cost = this.calculateCost(promptTokens, completionTokens, model);
    return { model, promptTokens, completionTokens, totalTokens, cost };
  }

  aggregateUsage(usageList: AIUsageMetrics[]): {
    totalCost: number;
    totalTokens: number;
    totalCalls: number;
    modelBreakdown: Record<
      string,
      { calls: number; tokens: number; cost: number }
    >;
  } {
    const modelBreakdown: Record<
      string,
      { calls: number; tokens: number; cost: number }
    > = {};
    let totalCost = 0;
    let totalTokens = 0;

    for (const usage of usageList) {
      totalCost += usage.cost;
      totalTokens += usage.totalTokens;
      const m = modelBreakdown[usage.model] ?? { calls: 0, tokens: 0, cost: 0 };
      m.calls += 1;
      m.tokens += usage.totalTokens;
      m.cost += usage.cost;
      modelBreakdown[usage.model] = m;
    }

    return {
      totalCost,
      totalTokens,
      totalCalls: usageList.length,
      modelBreakdown,
    };
  }

  getModelPricing(model: string): ModelPricing | null {
    return this.MODEL_PRICING[model] ?? null;
  }

  getAllModelPricing(): Record<string, ModelPricing> {
    return { ...this.MODEL_PRICING };
  }

  private computeCost(
    promptTokens: number,
    completionTokens: number,
    pricing: ModelPricing,
  ): number {
    const inputCost = (promptTokens / 1000) * pricing.input;
    const outputCost = (completionTokens / 1000) * pricing.output;
    return Math.round((inputCost + outputCost) * 1000000) / 1000000;
  }
}
