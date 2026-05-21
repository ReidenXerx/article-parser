import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ChatCompletion } from 'openai/resources/chat/completions';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { modelSupportsTemperature } from './model-capabilities';
import { TokenCostCalculatorService } from './token-cost-calculator.service';
import { AIUsageMetrics, EnhancedAIResponse } from './types/usage.types';

type MessageContent =
  | string
  | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: {
        url: string;
        detail?: 'low' | 'high' | 'auto';
      };
    }>;

interface ChatCompletionParams {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: MessageContent;
  }>;
  temperature?: number;
  response_format?: { type: 'json_object' };
  max_completion_tokens?: number;
}

/**
 * Thin OpenAI wrapper ported from Sourcerer-Be.
 *
 * Responsibilities:
 *   - Retry on transient errors (429 / 5xx) with exponential backoff
 *   - Strip `temperature` for GPT-5 / o1 / o3 reasoning models (HTTP 400 guard)
 *   - Bump `max_completion_tokens` default to 16k (the previous 4k was
 *     dangerously small for JSON-mode extractors on dense articles)
 *   - Dump request/response artifacts to the active ingest session
 *   - Track usage so the per-article cost summary lands in `decisions.log`
 *
 * Callers should NOT use this directly — prefer `OpenAIPromptService`.
 */
@Injectable()
export class OpenAIService {
  private readonly logger = new ArticleParserLogger(OpenAIService.name);
  private readonly openai: OpenAI | null;

  public getClient(): OpenAI {
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    return this.openai;
  }

  constructor(
    private readonly tokenCostCalculator: TokenCostCalculatorService,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Boot-tolerant: the deterministic pipeline still works without an
      // API key — AI fallbacks (meta-fields, validity second-opinion,
      // image-relevance) throw a clear error at call time instead of
      // preventing the whole app from starting.
      this.logger.warn(
        'OPENAI_API_KEY is not configured — AI fallbacks will throw at call time',
      );
      this.openai = null;
      return;
    }

    try {
      this.openai = new OpenAI({ apiKey, timeout: 180_000 });
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI client:', error);
      throw new Error('Failed to initialize OpenAI client');
    }
  }

  private promptLabel(
    messages: Array<{ role: string; content: MessageContent }>,
  ): string {
    const user = messages.find((m) => m.role === 'user');
    const raw =
      typeof user?.content === 'string'
        ? user.content
        : Array.isArray(user?.content)
          ? (user!.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join(' ')
          : '';
    return (
      raw
        .slice(0, 60)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'prompt'
    );
  }

  async createChatCompletion(
    params: ChatCompletionParams,
  ): Promise<ChatCompletion> {
    if (!this.openai) {
      throw new Error(
        'OPENAI_API_KEY is not configured — cannot run AI-powered extractor / gate. Set OPENAI_API_KEY in backend/.env.',
      );
    }

    const maxRetries = 3;
    let retryCount = 0;

    if (this.logger.session) {
      const label = this.promptLabel(params.messages);
      const reqPayload = JSON.stringify(
        {
          model: params.model,
          temperature: params.temperature,
          messages: params.messages,
        },
        null,
        2,
      );
      void this.logger.artifact('openai', label, 'req', reqPayload, 'json');
    }

    while (retryCount < maxRetries) {
      try {
        const { temperature: callerTemperature, ...rest } = params;
        const temperatureSection: { temperature?: number } =
          modelSupportsTemperature(params.model)
            ? { temperature: callerTemperature ?? 0.2 }
            : {};

        const response = await this.openai.chat.completions.create({
          ...rest,
          stream: false,
          max_completion_tokens: params.max_completion_tokens ?? 16384,
          ...temperatureSection,
        } as any);

        if (this.logger.session) {
          const label = this.promptLabel(params.messages);
          const resPayload = JSON.stringify(
            {
              model: response.model,
              usage: response.usage,
              content: response.choices[0]?.message?.content,
            },
            null,
            2,
          );
          void this.logger.artifact('openai', label, 'res', resPayload, 'json');
        }

        return response;
      } catch (error: unknown) {
        const err = error as { status?: number; code?: string; name?: string };

        if (err.code === 'insufficient_quota') {
          this.logger.error(
            'OpenAI quota exceeded. Check https://platform.openai.com/account/billing',
          );
          throw error;
        }

        const isRateLimit = err.status === 429;
        const isTransient =
          err.status === 500 ||
          err.status === 502 ||
          err.status === 503 ||
          err.status === 504 ||
          err.name === 'APIConnectionTimeoutError' ||
          err.name === 'APIConnectionError';

        if ((isRateLimit || isTransient) && retryCount < maxRetries - 1) {
          retryCount++;
          const wait = Math.pow(2, retryCount) * 1000;
          this.logger.warn(
            `OpenAI ${isRateLimit ? 'rate limit' : 'transient error'}, retrying in ${wait}ms (attempt ${retryCount}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }

        this.logger.error('OpenAI API call failed:', error);
        throw error;
      }
    }

    throw new Error('Max retries exceeded for OpenAI API call');
  }

  extractUsageMetrics(
    response: ChatCompletion,
    model: string,
  ): AIUsageMetrics {
    const usage = response.usage;
    if (!usage) {
      return {
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
      };
    }
    return this.tokenCostCalculator.createUsageMetrics(
      usage.prompt_tokens,
      usage.completion_tokens,
      model,
    );
  }

  async createChatCompletionWithUsage<T = string>(
    params: ChatCompletionParams,
    dataExtractor?: (response: ChatCompletion) => T,
  ): Promise<EnhancedAIResponse<T>> {
    const response = await this.createChatCompletion(params);
    const usage = this.extractUsageMetrics(response, params.model);
    const data = dataExtractor
      ? dataExtractor(response)
      : ((response.choices[0]?.message?.content || '') as T);
    return { data, usage };
  }
}
