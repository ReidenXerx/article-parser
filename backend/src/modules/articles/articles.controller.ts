import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsString, MinLength } from 'class-validator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { Article } from './article.entity';
import { ArticleIngestionService } from './article-ingestion.service';

class IngestDto {
  @IsString()
  @MinLength(20)
  source!: string;
}

@ApiTags('Articles')
@Controller('articles')
export class ArticlesController {
  private readonly logger = new ArticleParserLogger(ArticlesController.name);

  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    private readonly ingestion: ArticleIngestionService,
  ) {}

  @Post('ingest')
  @ApiOperation({
    summary: 'Ingest a Google Doc article, run the quality gate, persist the result.',
  })
  async ingest(@Body() dto: IngestDto) {
    try {
      const result = await this.ingestion.ingest(dto.source);
      return {
        articleId: result.article.id,
        finalDecision: result.article.qualityReport.finalDecision,
        score: result.article.qualityReport.deterministic.score,
        cost: result.costSummary.totalCost,
        rules: result.article.qualityReport.deterministic.rules,
      };
    } catch (err) {
      this.logger.error(
        `Ingestion failed for ${dto.source}: ${(err as Error).message}`,
        err,
      );
      throw new HttpException(
        {
          message: 'Ingestion failed',
          detail: (err as Error).message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'List ingested articles.' })
  async list(@Query('limit') limit = '50') {
    const parsed = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.articleRepo.find({
      order: { createdAt: 'DESC' },
      take: parsed,
    });
    return rows.map((a) => ({
      id: a.id,
      sourceUrl: a.sourceUrl,
      docId: a.docId,
      articleTitle: a.meta?.articleTitle,
      finalDecision: a.qualityReport?.finalDecision,
      score: a.qualityReport?.deterministic?.score,
      totalCost: a.totalCost,
      publishedTo: a.publishedTo,
      publishedAt: a.publishedAt,
      createdAt: a.createdAt,
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full article record with quality report.' })
  async detail(@Param('id') id: string) {
    const article = await this.articleRepo.findOne({ where: { id } });
    if (!article) throw new NotFoundException(`Article ${id} not found`);
    return article;
  }
}
