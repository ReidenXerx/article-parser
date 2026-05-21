import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { ExtractedImage } from '../extractors/extracted-article.types';
import { OpenAIPromptService } from '../openai/openai-prompt.service';

export interface ImageRelevanceVerdict {
  imageIndex: number;
  relevant: boolean;
  reason: string;
}

/**
 * STRETCH FEATURE — vision-based image relevance check.
 *
 * For each public image in the article, ask GPT-4o-mini (vision) to look
 * at the image and the surrounding paragraph text and answer "does this
 * image add visual context to this section?". Mirrors Sourcerer-Be's
 * poster-gallery extractor pattern (batched vision prompt, low-detail
 * images to keep token cost flat).
 *
 * Cost guard: only runs when `IMAGE_RELEVANCE_CHECK_ENABLED=true` (off
 * by default — opt-in for the demo / pricier tier). Concurrency-limited
 * because vision calls are slow.
 *
 * Adds a soft penalty to the quality gate (not currently wired into the
 * rule layer — surfaced as informational badges in the audit panel UI).
 */
@Injectable()
export class ImageRelevanceService {
  private readonly logger = new ArticleParserLogger(
    ImageRelevanceService.name,
  );

  constructor(private readonly openAIPromptService: OpenAIPromptService) {}

  isEnabled(): boolean {
    return process.env.IMAGE_RELEVANCE_CHECK_ENABLED === 'true';
  }

  /**
   * Vision model used for the relevance check.
   *
   * Decoupled from `OPENAI_MODEL_MINI` because the primary mini model
   * (gpt-5-mini, the current default) is a reasoning model that does NOT
   * accept vision inputs. Defaulting to `gpt-4o-mini` keeps the feature
   * working out of the box when an editor flips the enable flag,
   * without forcing them to also know which mini models support images.
   *
   * Override via `IMAGE_RELEVANCE_MODEL` if a newer vision-capable mini
   * model ships and you want to point this feature at it without
   * affecting the rest of the pipeline.
   */
  private getVisionModel(): string {
    return process.env.IMAGE_RELEVANCE_MODEL || 'gpt-4o-mini';
  }

  async checkBatch(images: ExtractedImage[]): Promise<ImageRelevanceVerdict[]> {
    if (!this.isEnabled()) return [];

    const eligible = images
      .map((img, i) => ({ img, i }))
      .filter(
        ({ img }) =>
          img.drive?.permission === 'public' && img.drive?.directViewUrl,
      );

    if (eligible.length === 0) return [];

    this.logger.decide(
      'IMAGE-RELEVANCE',
      `${eligible.length} eligible images`,
      'running vision check',
    );

    const results: ImageRelevanceVerdict[] = [];
    const concurrency = 3;
    let cursor = 0;

    const workers = Array.from(
      { length: Math.min(concurrency, eligible.length) },
      async () => {
        while (cursor < eligible.length) {
          const idx = cursor++;
          const { img, i } = eligible[idx];
          const verdict = await this.checkOne(i, img);
          if (verdict) results.push(verdict);
        }
      },
    );

    await Promise.all(workers);
    return results;
  }

  private async checkOne(
    imageIndex: number,
    image: ExtractedImage,
  ): Promise<ImageRelevanceVerdict | null> {
    const url = image.drive?.directViewUrl;
    if (!url) return null;

    const prompt = [
      'You are a visual content editor.',
      '',
      'Below is one image and the paragraph of article text it sits next to.',
      'Decide whether the image is visually relevant to that paragraph.',
      '',
      'Relevant = the image directly illustrates, demonstrates, or supports',
      'the surrounding text. Irrelevant = the image is a generic stock photo,',
      'a logo, a placeholder, or unrelated to the topic.',
      '',
      'Surrounding text:',
      image.surroundingText ?? '(no surrounding text captured)',
      '',
      'Respond with JSON only, exactly this shape:',
      '{"relevant":true|false,"reason":"<≤80 chars>"}',
    ].join('\n');

    try {
      const result =
        await this.openAIPromptService.executeVisionJsonPromptWithUsage<{
          relevant?: boolean;
          reason?: string;
        }>(prompt, url, {
          model: this.getVisionModel(),
          temperature: 0,
          imageDetail: 'low',
          moduleLabel: 'image-relevance',
        });

      const relevant = result.data?.relevant === true;
      const reason = (result.data?.reason ?? '').slice(0, 200);

      this.logger.decide(
        'IMAGE-RELEVANCE',
        `image[${imageIndex}]`,
        `relevant=${relevant}, reason=${reason}`,
      );

      return { imageIndex, relevant, reason };
    } catch (err) {
      this.logger.warn(
        `Image relevance check failed for image[${imageIndex}]: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
