import { Module } from '@nestjs/common';
import { OpenAIModule } from '../openai/openai.module';
import { BodyHtmlService } from './body-html.service';
import { FormattingAuditService } from './formatting-audit.service';
import { ImageInventoryService } from './image-inventory.service';
import { LinkInventoryService } from './link-inventory.service';
import { MetaFieldsService } from './meta-fields.service';

@Module({
  imports: [OpenAIModule],
  providers: [
    MetaFieldsService,
    BodyHtmlService,
    ImageInventoryService,
    LinkInventoryService,
    FormattingAuditService,
  ],
  exports: [
    MetaFieldsService,
    BodyHtmlService,
    ImageInventoryService,
    LinkInventoryService,
    FormattingAuditService,
  ],
})
export class ExtractorsModule {}
