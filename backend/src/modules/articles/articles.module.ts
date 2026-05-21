import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriveModule } from '../drive/drive.module';
import { ExtractorsModule } from '../extractors/extractors.module';
import { GoogleDocsModule } from '../google-docs/google-docs.module';
import { LinkValidationModule } from '../link-validation/link-validation.module';
import { OpenAIModule } from '../openai/openai.module';
import { QualityGateModule } from '../quality-gate/quality-gate.module';
import { ArticleIngestionService } from './article-ingestion.service';
import { Article } from './article.entity';
import { ArticlesController } from './articles.controller';
import { ImageRelevanceService } from './image-relevance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Article]),
    GoogleDocsModule,
    DriveModule,
    LinkValidationModule,
    ExtractorsModule,
    QualityGateModule,
    OpenAIModule,
  ],
  controllers: [ArticlesController],
  providers: [ArticleIngestionService, ImageRelevanceService],
  exports: [ArticleIngestionService],
})
export class ArticlesModule {}
