import { Injectable } from '@nestjs/common';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import {
  createEmptyUsage,
  EnhancedExtractionModule,
  ExtractionContext,
  UsageTrackedExtractionResult,
  createEnhancedResult,
} from './base/enhanced-extraction.interface';
import { ExtractedFormattingAudit } from './extracted-article.types';
import { normaliseText, parseHtml, walkElements } from './utils/dom.util';

/**
 * Basic structural-formatting audit.
 *
 * Surfaces the metrics the quality-gate rule layer keys off:
 *   - H1 count (should be exactly 1; the sample doc has 2 because the
 *     conclusion was wrongly styled — perfect demo case)
 *   - Heading outline (level + text) for hierarchy warnings ("H4 after
 *     H2 without H3" type rules)
 *   - Paragraph count + longest paragraph chars (paragraph walls hurt
 *     scannability)
 *   - Word count (lets the gate flag thin content)
 *   - Embedded images missing alt text (accessibility + SEO)
 *
 * Fully deterministic. The rule layer decides which numbers are good or
 * bad — this service is "what's actually in the doc" without judgement.
 */
@Injectable()
export class FormattingAuditService
  implements EnhancedExtractionModule<ExtractedFormattingAudit>
{
  readonly name = 'formatting-audit';
  private readonly logger = new ArticleParserLogger(
    FormattingAuditService.name,
  );

  async extractWithUsage(
    html: string,
    _context?: ExtractionContext,
  ): Promise<UsageTrackedExtractionResult<ExtractedFormattingAudit>> {
    const { body } = parseHtml(html);

    let h1Count = 0;
    let imagesMissingAlt = 0;
    let paragraphCount = 0;
    let maxParagraphChars = 0;
    const headingOutline: Array<{
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
    }> = [];

    for (const el of walkElements(body)) {
      const tag = el.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
        const text = normaliseText(el.textContent ?? '');
        if (level === 1) h1Count += 1;
        headingOutline.push({ level, text });
      } else if (tag === 'P') {
        const text = normaliseText(el.textContent ?? '');
        if (text.length === 0) continue;
        paragraphCount += 1;
        if (text.length > maxParagraphChars) {
          maxParagraphChars = text.length;
        }
      } else if (tag === 'IMG') {
        const img = el as HTMLImageElement;
        const alt = normaliseText(img.getAttribute('alt') ?? '');
        if (!alt) imagesMissingAlt += 1;
      }
    }

    const wordCount = (normaliseText(body.textContent ?? '').match(
      /\S+/g,
    ) ?? []).length;

    const data: ExtractedFormattingAudit = {
      h1Count,
      headingOutline,
      paragraphCount,
      maxParagraphChars,
      wordCount,
      imagesMissingAlt,
    };

    this.logger.decide(
      'FORMAT-AUDIT',
      `h1=${h1Count}, headings=${headingOutline.length}, paragraphs=${paragraphCount}`,
      `maxParaChars=${maxParagraphChars}, wordCount=${wordCount}, missingAlt=${imagesMissingAlt}`,
    );

    return createEnhancedResult(data, 1, createEmptyUsage());
  }
}
