import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { IsOptional, IsBoolean } from 'class-validator';
import { Article } from '../articles/article.entity';
import { ShopifyService } from './shopify.service';
import { WordPressService } from './wordpress.service';

class PublishDto {
  /**
   * Skip the quality-gate `accept` check and publish anyway. Editor
   * teams sometimes need to ship articles the rules disagree with
   * (rare; we still log the override).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@ApiTags('Publishers')
@Controller('articles/:articleId')
export class PublishersController {
  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    private readonly wordpress: WordPressService,
    private readonly shopify: ShopifyService,
  ) {}

  @Post('publish/wordpress')
  @ApiOperation({ summary: 'Publish to WordPress (mocked unless MOCK_UPLOAD=false).' })
  async publishToWordPress(
    @Param('articleId') articleId: string,
    @Body() body: PublishDto,
  ) {
    return this.publish(articleId, this.wordpress, body);
  }

  @Post('publish/shopify')
  @ApiOperation({ summary: 'Publish to Shopify (mocked unless MOCK_UPLOAD=false).' })
  async publishToShopify(
    @Param('articleId') articleId: string,
    @Body() body: PublishDto,
  ) {
    return this.publish(articleId, this.shopify, body);
  }

  private async publish(
    articleId: string,
    publisher: WordPressService | ShopifyService,
    body: PublishDto,
  ) {
    const article = await this.articleRepo.findOne({ where: { id: articleId } });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);

    const decision = article.qualityReport?.finalDecision;
    if (decision !== 'accept' && !body.force) {
      throw new BadRequestException({
        message: `Article quality gate verdict is "${decision}". Re-run ingestion after fixing the flagged issues, or POST with force=true to override.`,
        decision,
      });
    }

    try {
      const result = await publisher.publish(article);

      if (result.status === 'ok') {
        article.publishedTo = publisher.name;
        article.publishedId = result.externalId;
        article.publishedAt = new Date();
        await this.articleRepo.save(article);
      }

      return result;
    } catch (err) {
      throw new HttpException(
        { message: 'Publish failed', detail: (err as Error).message },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
