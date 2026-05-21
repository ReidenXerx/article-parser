import { Module } from '@nestjs/common';
import { OpenAIModule } from '../openai/openai.module';
import { ArticleValidityService } from './article-validity.service';

@Module({
  imports: [OpenAIModule],
  providers: [ArticleValidityService],
  exports: [ArticleValidityService],
})
export class QualityGateModule {}
