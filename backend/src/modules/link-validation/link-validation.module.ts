import { Module } from '@nestjs/common';
import { LinkValidationService } from './link-validation.service';

@Module({
  providers: [LinkValidationService],
  exports: [LinkValidationService],
})
export class LinkValidationModule {}
