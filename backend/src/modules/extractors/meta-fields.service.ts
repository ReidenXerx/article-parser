import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { OpenAIPromptService } from '../openai/openai-prompt.service';
import {
  createEmptyUsage,
  EnhancedExtractionModule,
  ExtractionContext,
  UsageTrackedExtractionResult,
  createEnhancedResult,
} from './base/enhanced-extraction.interface';
import { ExtractedMetaFields } from './extracted-article.types';
import { normaliseText, parseHtml } from './utils/dom.util';

/**
 * Extract the three publisher-required fields: article title, meta title,
 * meta description.
 *
 * Strategy (cheap → expensive, mirrors Sourcerer-Be's cascading pattern):
 *
 *   1. ARTICLE TITLE — first H1 in the body. Deterministic, no AI.
 *      Falls back to <title> tag, then AI if both miss.
 *
 *   2. META TITLE / META DESCRIPTION — regex pass against the body text
 *      for the Yoast-style inline annotations the writer team uses:
 *          **Meta Title:** Best Leather Dog Collars: Pamper Your Pooch
 *          **Meta Description:** Discover the best leather dog collars…
 *      These come back literally because the writer types them as bold
 *      labels at the top of the doc. The regex catches both the bold
 *      `<strong>Meta Title:</strong>` and plain-text variants. Reads
 *      ahead until the next blank line or `**` marker so descriptions
 *      that span multiple sentences are captured intact.
 *
 *   3. AI FALLBACK — only when the regex misses BOTH fields, we ask the
 *      mini model to extract them from the body in one batched call.
 *      Cheapest model, JSON-only, fail-open (returns nulls on parse
 *      failure rather than blocking the pipeline).
 */
@Injectable()
export class MetaFieldsService
  implements EnhancedExtractionModule<ExtractedMetaFields>
{
  readonly name = 'meta-fields';
  private readonly logger = new ArticleParserLogger(MetaFieldsService.name);

  /**
   * Per-paragraph label matchers. Each meta annotation lives in its own
   * `<p>` in Google's HTML export — label in one <span>, value in the
   * next. We iterate over paragraphs (not flattened text) because the
   * export collapses newlines, which would cause a greedy regex on the
   * whole body to swallow the rest of the document.
   *
   * Anchored to the START of the paragraph so "Read more about meta
   * descriptions" inside body copy doesn't fire the rule.
   */
  private readonly META_TITLE_PARA_RX = /^\s*Meta\s*Title\s*:?\s*(.*)$/i;
  private readonly META_DESC_PARA_RX = /^\s*Meta\s*Description\s*:?\s*(.*)$/i;

  constructor(private readonly openAIPromptService: OpenAIPromptService) {}

  async extractWithUsage(
    html: string,
    context?: ExtractionContext,
  ): Promise<UsageTrackedExtractionResult<ExtractedMetaFields>> {
    const { document, body } = parseHtml(html);

    // ── 1. Article title from the first H1 ─────────────────────────
    const firstH1 = body.querySelector('h1');
    let articleTitle = normaliseText(firstH1?.textContent ?? '');
    let articleTitleSource: ExtractedMetaFields['source']['articleTitle'] =
      'h1';

    if (!articleTitle) {
      const titleTag = document.querySelector('title');
      articleTitle = normaliseText(titleTag?.textContent ?? '');
      articleTitleSource = articleTitle ? 'h1' : 'missing';
    }

    // ── 2. Per-paragraph scan for `Meta Title:` / `Meta Description:` ──
    //
    // Walk every `<p>` (and `<div>` fallback) in the first ~20 block
    // elements — that's where editorial style puts these annotations.
    // For each paragraph, check if its TRIMMED text matches one of the
    // label patterns; if so, the regex's capture group is the value.
    // First match wins (writers don't double-up labels in practice).
    let metaTitle: string | null = null;
    let metaDescription: string | null = null;
    const blocks = Array.from(body.querySelectorAll('p, div'));
    for (const block of blocks.slice(0, 30)) {
      const text = normaliseText(block.textContent ?? '');
      if (!text) continue;

      if (!metaTitle) {
        const tm = this.META_TITLE_PARA_RX.exec(text);
        if (tm?.[1]) metaTitle = normaliseText(tm[1]);
      }
      if (!metaDescription) {
        const dm = this.META_DESC_PARA_RX.exec(text);
        if (dm?.[1]) metaDescription = normaliseText(dm[1]);
      }

      if (metaTitle && metaDescription) break;
    }

    let metaTitleSource: ExtractedMetaFields['source']['metaTitle'] =
      metaTitle ? 'regex' : 'missing';
    let metaDescSource: ExtractedMetaFields['source']['metaDescription'] =
      metaDescription ? 'regex' : 'missing';

    let usage = createEmptyUsage();

    // ── 3. AI fallback only if BOTH meta fields are missing ────────
    // (the test brief explicitly requires both, so partial-extraction
    // shouldn't escalate to AI — it's already a deterministic miss the
    // editor can fix in the doc.)
    if (!metaTitle && !metaDescription) {
      this.logger.decide(
        'META-FIELDS',
        'regex',
        'no Meta Title/Description annotations found, falling back to AI',
      );

      const ai = await this.aiFallback(
        articleTitle,
        normaliseText(body.textContent ?? '').slice(0, 4000),
        context?.modelOverride,
      );
      usage = ai.usage;

      if (ai.data.metaTitle) {
        metaTitle = ai.data.metaTitle;
        metaTitleSource = 'ai-fallback';
      }
      if (ai.data.metaDescription) {
        metaDescription = ai.data.metaDescription;
        metaDescSource = 'ai-fallback';
      }
      if (!articleTitle && ai.data.articleTitle) {
        articleTitle = ai.data.articleTitle;
        articleTitleSource = 'ai-fallback';
      }
    }

    this.logger.decide(
      'META-FIELDS',
      `articleTitle=${articleTitleSource}, metaTitle=${metaTitleSource}, metaDescription=${metaDescSource}`,
      `extracted="${articleTitle.slice(0, 40)}…"`,
    );

    const data: ExtractedMetaFields = {
      articleTitle,
      metaTitle,
      metaDescription,
      source: {
        articleTitle: articleTitleSource,
        metaTitle: metaTitleSource,
        metaDescription: metaDescSource,
      },
    };

    return createEnhancedResult(data, 1, usage);
  }

  /**
   * One-call AI fallback. Returns nulls on any failure (fail-open).
   * Uses the mini model since this is straightforward field extraction.
   */
  private async aiFallback(
    articleTitle: string,
    bodyExcerpt: string,
    modelOverride?: string,
  ) {
    const prompt = [
      'Extract the article title, meta title, and meta description from the article below.',
      '',
      'INSTRUCTIONS:',
      '  - The article title is the headline a reader would see (often the first H1 in the doc).',
      '  - The meta title is a ~60-character SEO title for search engine results.',
      '  - The meta description is a ~155-character SEO summary for search engine snippets.',
      '  - If a field is not in the doc, return null — DO NOT invent one.',
      '',
      articleTitle ? `Article title hint (already extracted from H1): ${articleTitle}` : '',
      '',
      'Article body (first 4000 chars):',
      bodyExcerpt,
      '',
      'Respond with JSON only, exactly this shape:',
      '{"articleTitle":"…or null","metaTitle":"…or null","metaDescription":"…or null"}',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await this.openAIPromptService.executeJsonPromptWithUsage<{
        articleTitle?: string | null;
        metaTitle?: string | null;
        metaDescription?: string | null;
      }>(prompt, {
        model: modelOverride || this.openAIPromptService.miniModel,
        temperature: 0,
        moduleLabel: this.name,
      });

      return {
        data: {
          articleTitle: result.data?.articleTitle?.trim() || null,
          metaTitle: result.data?.metaTitle?.trim() || null,
          metaDescription: result.data?.metaDescription?.trim() || null,
        },
        usage: result.usage,
      };
    } catch (err) {
      this.logger.warn(
        `Meta-field AI fallback failed: ${(err as Error).message} — falling back to nulls`,
      );
      return {
        data: { articleTitle: null, metaTitle: null, metaDescription: null },
        usage: createEmptyUsage(),
      };
    }
  }
}
