import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { DriveService } from '../drive/drive.service';
import {
  ExtractedArticle,
  ExtractedImage,
} from '../extractors/extracted-article.types';
import { BodyHtmlService } from '../extractors/body-html.service';
import { FormattingAuditService } from '../extractors/formatting-audit.service';
import { ImageInventoryService } from '../extractors/image-inventory.service';
import { LinkInventoryService } from '../extractors/link-inventory.service';
import { MetaFieldsService } from '../extractors/meta-fields.service';
import { GoogleDocsService } from '../google-docs/google-docs.service';
import { ArticleValidityService } from '../quality-gate/article-validity.service';
import { Article } from './article.entity';
import {
  ImageRelevanceService,
  ImageRelevanceVerdict,
} from './image-relevance.service';

export interface IngestResult {
  article: Article;
  extracted: ExtractedArticle;
  imageRelevance: ImageRelevanceVerdict[];
  costSummary: {
    totalCost: number;
    totalTokens: number;
    totalCalls: number;
    byModel: Record<string, { calls: number; tokens: number; cost: number }>;
    byModule: Record<string, { calls: number; tokens: number; cost: number }>;
  };
}

/**
 * End-to-end ingest orchestrator.
 *
 * One ingestion =
 *   1. Fetch the doc HTML (Google Docs cascade: public export → API)
 *   2. Run extractors:
 *        meta-fields (regex → AI fallback)
 *        body-html   (sanitize for WordPress)
 *        images, links, formatting (deterministic)
 *      In parallel where the inputs allow.
 *   3. Drive-check every image — populates `image.drive` on each entry.
 *   4. Optional stretch: image-relevance vision check (opt-in).
 *   5. Quality gate — deterministic scorer + AI second-opinion on borderline.
 *   6. Persist the full article row + the quality report.
 *
 * The whole thing runs inside a `logger.run({ kind: 'ingest', ... })`
 * scope so every decision and every AI call is captured in a per-article
 * decision log + artifact folder under `logs/ingest/`.
 */
@Injectable()
export class ArticleIngestionService {
  private readonly logger = new ArticleParserLogger(
    ArticleIngestionService.name,
  );

  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    private readonly googleDocs: GoogleDocsService,
    private readonly drive: DriveService,
    private readonly metaFields: MetaFieldsService,
    private readonly bodyHtml: BodyHtmlService,
    private readonly imageInventory: ImageInventoryService,
    private readonly linkInventory: LinkInventoryService,
    private readonly formattingAudit: FormattingAuditService,
    private readonly imageRelevance: ImageRelevanceService,
    private readonly validity: ArticleValidityService,
  ) {}

  async ingest(urlOrId: string): Promise<IngestResult> {
    const articleId = uuidv4();

    return this.logger.run(
      { kind: 'ingest', articleId, sourceUrl: urlOrId },
      async () => {
        this.logger.step('Fetch Google Doc');
        const doc = await this.googleDocs.fetch(urlOrId);

        this.logger.step('Run extractors');
        const [
          metaResult,
          bodyResult,
          imageResult,
          linkResult,
          formattingResult,
        ] = await Promise.all([
          this.metaFields.extractWithUsage(doc.html, {
            sourceUrl: urlOrId,
            docId: doc.docId,
          }),
          this.bodyHtml.extractWithUsage(doc.html, {
            sourceUrl: urlOrId,
            docId: doc.docId,
          }),
          this.imageInventory.extractWithUsage(doc.html, {
            sourceUrl: urlOrId,
            docId: doc.docId,
          }),
          this.linkInventory.extractWithUsage(doc.html, {
            sourceUrl: urlOrId,
            docId: doc.docId,
          }),
          this.formattingAudit.extractWithUsage(doc.html, {
            sourceUrl: urlOrId,
            docId: doc.docId,
          }),
        ]);

        this.logger.step('Drive permission check');
        const enrichedImages = await this.driveCheckImages(imageResult.data);

        // Assemble the canonical extracted article shape
        const extracted: ExtractedArticle = {
          sourceUrl: urlOrId,
          docId: doc.docId,
          meta: metaResult.data,
          body: bodyResult.data,
          images: enrichedImages,
          links: linkResult.data,
          formatting: formattingResult.data,
        };

        this.logger.step('Image relevance check (stretch)');
        const imageRelevance = await this.imageRelevance.checkBatch(
          enrichedImages,
        );

        this.logger.step('Quality gate');
        const qualityReport = await this.validity.assess(extracted);

        this.logger.step('Persist');
        const costSummary = this.logger.summarize();
        const article = await this.articleRepo.save({
          id: articleId,
          sourceUrl: urlOrId,
          docId: doc.docId,
          ingestMode: doc.mode,
          meta: extracted.meta,
          bodyClean: extracted.body.cleanHtml,
          bodyRaw: extracted.body.rawHtml,
          images: extracted.images,
          links: extracted.links,
          formatting: extracted.formatting,
          qualityReport,
          totalCost: costSummary.totalCost,
          publishedId: null,
          publishedTo: null,
          publishedAt: null,
        });

        this.logger.decide(
          'QUALITY-SUMMARY',
          `articleId=${article.id}`,
          `decision=${qualityReport.finalDecision}, cost=$${costSummary.totalCost.toFixed(6)}, tokens=${costSummary.totalTokens}, calls=${costSummary.totalCalls}`,
        );

        return { article, extracted, imageRelevance, costSummary };
      },
    );
  }

  /**
   * Run the Drive HEAD probe over every image and merge results back
   * into the image objects. Done as a separate step (not inside the
   * extractor) because it does network I/O — keeping it out of the
   * extractor stage means extractors stay pure and parallelisable.
   */
  private async driveCheckImages(
    images: ExtractedImage[],
  ): Promise<ExtractedImage[]> {
    if (images.length === 0) return images;

    const driveInfo = await this.drive.checkBatch(
      images.map((i) => i.rawUrl),
      4,
    );

    let publicCount = 0;
    let privateCount = 0;
    let notDriveCount = 0;
    let unknownCount = 0;

    const enriched = images.map((img, i) => {
      const info = driveInfo[i];
      if (!info) return img;
      switch (info.permission) {
        case 'public':
          publicCount += 1;
          break;
        case 'private':
          privateCount += 1;
          break;
        case 'not-drive':
          notDriveCount += 1;
          break;
        case 'unknown':
          unknownCount += 1;
          break;
      }
      return {
        ...img,
        drive: {
          fileId: info.fileId,
          directViewUrl: info.directViewUrl,
          permission: info.permission,
          status: info.status,
        },
      };
    });

    this.logger.decide(
      'DRIVE-PERM',
      `${images.length} images probed`,
      `public=${publicCount}, private=${privateCount}, not-drive=${notDriveCount}, unknown=${unknownCount}`,
    );

    return enriched;
  }
}
