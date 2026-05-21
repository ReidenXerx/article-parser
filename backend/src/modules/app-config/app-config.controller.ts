import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';
import { AppConfigService } from './app-config.service';

class UpdateAppConfigDto {
  @IsOptional()
  @IsInt()
  acceptThreshold?: number;

  @IsOptional()
  @IsInt()
  rejectThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minImages?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxImages?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minProductLinks?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxProductLinks?: number;

  @IsOptional()
  @IsObject()
  ruleWeights?: Record<string, number>;
}

@ApiTags('App Config')
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Current quality-gate config (thresholds + rule weight overrides).' })
  async get() {
    return this.appConfig.get();
  }

  @Put()
  @ApiOperation({ summary: 'Update quality-gate config. Takes effect on the next ingest.' })
  async update(@Body() dto: UpdateAppConfigDto) {
    return this.appConfig.update(dto);
  }
}
