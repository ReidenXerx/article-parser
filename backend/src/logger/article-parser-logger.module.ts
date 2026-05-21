import { Global, Module } from '@nestjs/common';
import { ArticleParserLogger } from './article-parser-logger.service';

@Global()
@Module({
  providers: [ArticleParserLogger],
  exports: [ArticleParserLogger],
})
export class ArticleParserLoggerModule {}
