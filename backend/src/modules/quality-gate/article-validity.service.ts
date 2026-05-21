import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { AppConfigService } from '../app-config/app-config.service';
import { ExtractedArticle } from '../extractors/extracted-article.types';
import { OpenAIPromptService } from '../openai/openai-prompt.service';
import {
  assessArticleQuality,
  formatDeterministicVerdict,
} from './article-validity.util';
import {
  AiVerdict,
  AssessmentInput,
  DeterministicVerdict,
  QualityGateConfig,
  QualityReport,
} from './types';

/**
 * Two-stage article quality gate.
 *
 * Mirrors Sourcerer-Be's event-validity flow:
 *
 *   1. DETERMINISTIC SCORER (`assessArticleQuality`) — runs the full rule
 *      set, sums weights, decides `accept` / `reject` / `escalate`. Free.
 *
 *   2. AI SECOND-OPINION (`classifyBorderline`) — runs ONLY on `escalate`
 *      verdicts. Sends the article body + the rule findings so far to
 *      the mini model with one focused prompt asking for a final yes/no.
 *      The model gets context about the rule layer's uncertainty and is
 *      explicitly asked to focus on judgement calls regex can't make
 *      (image-context relevance, link copy naturalness).
 *
 *      Fail-open: if the AI call fails, falls back to the deterministic
 *      verdict's `score >= 0 ? accept : reject` tiebreak. Never silently
 *      blocks an article because of a flaky AI call.
 */
@Injectable()
export class ArticleValidityService {
  private readonly logger = new ArticleParserLogger(
    ArticleValidityService.name,
  );

  constructor(
    private readonly openAIPromptService: OpenAIPromptService,
    private readonly appConfig: AppConfigService,
  ) {}

  private getValidityModel(): string {
    return (
      process.env.ARTICLE_VALIDITY_MODEL ||
      this.openAIPromptService.primaryModel
    );
  }

  /**
   * Run the full two-stage gate and return a structured report.
   */
  async assess(article: ExtractedArticle, cfgOverride?: QualityGateConfig): Promise<QualityReport> {
    const cfg = cfgOverride ?? (await this.appConfig.get());
    const input: AssessmentInput = { article };

    const deterministic = assessArticleQuality(input, cfg);
    this.logger.decide(
      'QUALITY-VERDICT',
      'deterministic',
      formatDeterministicVerdict(deterministic),
    );

    if (deterministic.decision !== 'escalate') {
      return {
        finalDecision: deterministic.decision,
        deterministic,
      };
    }

    // Escalate → AI second-opinion
    const ai = await this.classifyBorderline(article, deterministic);

    const finalDecision: QualityReport['finalDecision'] =
      ai?.verdict === 'accept'
        ? 'accept'
        : ai?.verdict === 'reject'
          ? 'reject'
          : deterministic.score >= 0
            ? 'accept'
            : 'reject';

    this.logger.decide(
      'QUALITY-VERDICT',
      'final',
      `${finalDecision} (deterministic=${deterministic.decision}, ai=${ai?.verdict ?? 'unavailable'})`,
    );

    return {
      finalDecision,
      deterministic,
      ai: ai ?? undefined,
    };
  }

  /**
   * AI second-opinion. Returns `null` on any failure so callers can
   * fall back to the deterministic tiebreak (fail-open, matching
   * Sourcerer-Be).
   */
  private async classifyBorderline(
    article: ExtractedArticle,
    deterministic: DeterministicVerdict,
  ): Promise<AiVerdict | null> {
    try {
      const ruleSummary = deterministic.rules
        .map((r) => `  ${r.weight >= 0 ? '+' : ''}${r.weight}  ${r.name}: ${r.matched}`)
        .join('\n');

      const prompt = [
        'You are a senior SEO editor reviewing an article for an ecommerce client.',
        '',
        'The deterministic quality scorer is uncertain about this article and has',
        'escalated it for your judgement. Below are the article fields and the rules',
        `that fired (total score: ${deterministic.score}).`,
        '',
        'Your job: decide ACCEPT or REJECT.',
        '',
        'Lean toward ACCEPT if the article is broadly publishable with minor flaws.',
        'Lean toward REJECT if a) meta fields are missing, b) product links are',
        'clearly wrong / missing, c) images are private/broken/non-Drive AND',
        'matter to the article, d) the writing reads as low-effort or off-topic.',
        '',
        'Consider editorial judgement the rules can\'t make:',
        '  - Are the product links naturally embedded, or do they read as keyword-stuffed?',
        '  - Do the section headings build a coherent narrative?',
        '  - Is the meta description compelling, or generic?',
        '',
        '── Rule findings ──',
        ruleSummary,
        '',
        '── Article meta ──',
        `Article title:     ${article.meta.articleTitle || '(missing)'}`,
        `Meta title:        ${article.meta.metaTitle || '(missing)'}`,
        `Meta description:  ${article.meta.metaDescription || '(missing)'}`,
        '',
        '── Stats ──',
        `Word count:        ${article.formatting.wordCount}`,
        `Images:            ${article.images.length} (embedded=${article.images.filter((i) => i.kind === 'embedded').length}, placeholders=${article.images.filter((i) => i.kind === 'placeholder-link').length})`,
        `Product links:     ${article.links.filter((l) => l.classification === 'product').length}`,
        `Headings:          ${article.formatting.headingOutline.map((h) => `H${h.level}`).join(' → ')}`,
        '',
        '── Article body (first 3000 chars) ──',
        (article.body.cleanHtml ?? article.body.rawHtml).replace(/<[^>]+>/g, ' ').slice(0, 3000),
        '',
        'Respond with JSON only, exactly this shape:',
        '{"verdict":"accept"|"reject","reasoning":"<≤200 chars summary of why>"}',
      ].join('\n');

      const result = await this.openAIPromptService.executeJsonPromptWithUsage<{
        verdict?: 'accept' | 'reject';
        reasoning?: string;
      }>(prompt, {
        model: this.getValidityModel(),
        temperature: 0,
        moduleLabel: 'article-validity',
      });

      const verdict = result.data?.verdict;
      const reasoning = result.data?.reasoning ?? '';
      if (verdict !== 'accept' && verdict !== 'reject') {
        this.logger.warn(
          `Article-validity AI returned malformed verdict: ${JSON.stringify(result.data)}`,
        );
        return null;
      }

      this.logger.decide('QUALITY-AI', 'second-opinion', `${verdict}: ${reasoning}`);

      return { verdict, reasoning };
    } catch (err) {
      this.logger.warn(
        `Article-validity AI second-opinion failed (${
          err instanceof Error ? err.message : 'unknown error'
        }) — falling back to deterministic tiebreak`,
      );
      return null;
    }
  }
}
