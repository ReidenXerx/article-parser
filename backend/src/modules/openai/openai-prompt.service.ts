import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { OpenAIService } from './openai.service';
import { EnhancedAIResponse } from './types/usage.types';

export interface PromptOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Caller name for usage tracking — shows up in `byModule` summary. */
  moduleLabel?: string;
}

/**
 * High-level prompt API — what every extractor / classifier in the system
 * should depend on.
 *
 * Provides four call modes:
 *   - `executeJsonPrompt`       — JSON-only, throws if response isn't parseable
 *   - `executeJsonPromptWithUsage` — same but returns usage metrics
 *   - `executeVisionJsonPromptWithUsage` — vision-enabled JSON mode (single image)
 *   - `executeTextPrompt`       — non-JSON, returns string
 *
 * All paths run responses through `attemptJsonRepair()` first — closing
 * unclosed braces/brackets and patching common truncation patterns. The
 * model occasionally returns truncated JSON when it runs into the token
 * limit; the repair logic catches the bulk of these without re-calling.
 */
@Injectable()
export class OpenAIPromptService {
  private readonly logger = new ArticleParserLogger(
    OpenAIPromptService.name,
  );

  /** Primary model for complex tasks (extraction, AI second-opinion). */
  readonly primaryModel: string =
    process.env.OPENAI_MODEL || 'gpt-5-mini';

  /** Mini model for cheap classification / batched borderline review. */
  readonly miniModel: string =
    process.env.OPENAI_MODEL_MINI || 'gpt-5-mini';

  constructor(private readonly openAIService: OpenAIService) {}

  async executeJsonPrompt<T = unknown>(
    prompt: string,
    options: PromptOptions = {},
  ): Promise<T> {
    const response = await this.openAIService.createChatCompletion({
      model: options.model || this.primaryModel,
      messages: [
        {
          role: 'system',
          content:
            'You are a JSON-only response bot. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: options.temperature,
      max_completion_tokens: options.maxTokens,
    });

    try {
      const raw = response.choices[0]?.message?.content || '{}';
      const cleaned = this.attemptJsonRepair(raw);
      return JSON.parse(cleaned) as T;
    } catch (error) {
      this.logger.error('Failed to parse JSON response:', error);
      this.logger.error('Raw:', response.choices[0]?.message?.content);
      throw new Error('Invalid JSON response from OpenAI');
    }
  }

  async executeJsonPromptWithUsage<T = unknown>(
    prompt: string,
    options: PromptOptions = {},
  ): Promise<EnhancedAIResponse<T>> {
    const model = options.model || this.primaryModel;

    const response = await this.openAIService.createChatCompletionWithUsage(
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a JSON-only response bot. Always respond with valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: options.temperature,
        max_completion_tokens: options.maxTokens,
      },
      (chat) => {
        try {
          const raw = chat.choices[0]?.message?.content || '{}';
          const cleaned = this.attemptJsonRepair(raw);
          return JSON.parse(cleaned) as T;
        } catch (error) {
          this.logger.error('Failed to parse JSON response:', error);
          this.logger.error('Raw:', chat.choices[0]?.message?.content);
          throw new Error('Invalid JSON response from OpenAI');
        }
      },
    );

    // Pipe usage into the active ingest session if there is one
    this.logger.trackUsage(options.moduleLabel || 'openai', response.usage);

    return response;
  }

  async executeVisionJsonPromptWithUsage<T = unknown>(
    textPrompt: string,
    imageUrl: string,
    options: PromptOptions & {
      imageDetail?: 'low' | 'high' | 'auto';
    } = {},
  ): Promise<EnhancedAIResponse<T>> {
    const processedImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : imageUrl.startsWith('data:')
        ? imageUrl
        : `data:image/png;base64,${imageUrl}`;

    const model = options.model || this.primaryModel;

    const response = await this.openAIService.createChatCompletionWithUsage(
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a JSON-only response bot. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: textPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: processedImageUrl,
                  detail: options.imageDetail || 'low',
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        temperature: options.temperature,
      },
      (chat) => {
        try {
          const raw = chat.choices[0]?.message?.content || '{}';
          const cleaned = this.attemptJsonRepair(raw);
          return JSON.parse(cleaned) as T;
        } catch (error) {
          this.logger.error('Failed to parse vision JSON response:', error);
          this.logger.error('Raw:', chat.choices[0]?.message?.content);
          throw new Error('Invalid JSON response from OpenAI Vision');
        }
      },
    );

    this.logger.trackUsage(options.moduleLabel || 'openai-vision', response.usage);

    return response;
  }

  async executeTextPrompt(
    prompt: string,
    options: PromptOptions = {},
  ): Promise<string> {
    const response = await this.openAIService.createChatCompletion({
      model: options.model || this.primaryModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature,
    });
    return response.choices[0]?.message?.content || '';
  }

  /**
   * Best-effort repair for truncated / malformed JSON responses.
   * Ported from Sourcerer-Be's `OpenAIPromptService.attemptJsonRepair`.
   */
  private attemptJsonRepair(jsonString: string): string {
    if (!jsonString) return '{}';

    try {
      JSON.parse(jsonString);
      return jsonString;
    } catch {
      this.logger.warn('Attempting to repair malformed JSON response');
    }

    let repaired = jsonString.trim();
    if (repaired.endsWith('"')) {
      repaired += ': ""';
    }

    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '[') openBrackets++;
        if (char === ']') openBrackets--;
      }
    }

    while (openBrackets > 0) {
      repaired += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      repaired += '}';
      openBraces--;
    }

    try {
      JSON.parse(repaired);
      this.logger.debug('Successfully repaired malformed JSON');
      return repaired;
    } catch {
      this.logger.error('Failed to repair JSON, returning empty object');
      return '{}';
    }
  }
}
