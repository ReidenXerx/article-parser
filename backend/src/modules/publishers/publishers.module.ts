import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Article } from '../articles/article.entity';
import { PublishersController } from './publishers.controller';
import { ShopifyService } from './shopify.service';
import { WordPressService } from './wordpress.service';

@Module({
  imports: [TypeOrmModule.forFeature([Article])],
  controllers: [PublishersController],
  providers: [WordPressService, ShopifyService],
  exports: [WordPressService, ShopifyService],
})
export class PublishersModule {}
