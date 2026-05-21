import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArticleParserLogger } from '../../logger/article-parser-logger.service';
import { loadConfigFromEnv } from '../quality-gate/quality-gate.config';
import { QualityGateConfig } from '../quality-gate/types';
import { AppConfig } from './app-config.entity';

/**
 * Runtime-tunable config store.
 *
 * The QualityGate's per-article scorer reads through this service (not
 * directly from env) so a PUT to /api/app-config takes effect on the
 * NEXT ingest with no restart. Defaults seed from env on first boot —
 * `loadConfigFromEnv()` lives in the quality-gate module so the same
 * shape works in tests that bypass persistence.
 */
@Injectable()
export class AppConfigService implements OnApplicationBootstrap {
  private readonly logger = new ArticleParserLogger(AppConfigService.name);
  private readonly DEFAULT_ID = 'default';

  constructor(
    @InjectRepository(AppConfig)
    private readonly repo: Repository<AppConfig>,
  ) {}

  /** Seed the singleton row from env on first boot. */
  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.repo.findOne({ where: { id: this.DEFAULT_ID } });
    if (existing) return;

    const fromEnv = loadConfigFromEnv();
    await this.repo.save({
      id: this.DEFAULT_ID,
      acceptThreshold: fromEnv.acceptThreshold,
      rejectThreshold: fromEnv.rejectThreshold,
      minImages: fromEnv.minImages,
      maxImages: fromEnv.maxImages,
      minProductLinks: fromEnv.minProductLinks,
      maxProductLinks: fromEnv.maxProductLinks,
      ruleWeights: fromEnv.ruleWeights,
    });
    this.logger.log('Seeded default AppConfig from env');
  }

  async get(): Promise<QualityGateConfig> {
    const row = await this.repo.findOne({ where: { id: this.DEFAULT_ID } });
    if (!row) {
      // Fallback shouldn't happen post-bootstrap but stays graceful
      return loadConfigFromEnv();
    }
    return {
      acceptThreshold: row.acceptThreshold,
      rejectThreshold: row.rejectThreshold,
      minImages: row.minImages,
      maxImages: row.maxImages,
      minProductLinks: row.minProductLinks,
      maxProductLinks: row.maxProductLinks,
      ruleWeights: row.ruleWeights ?? {},
    };
  }

  async update(patch: Partial<QualityGateConfig>): Promise<QualityGateConfig> {
    const current = await this.repo.findOne({ where: { id: this.DEFAULT_ID } });
    const merged = {
      id: this.DEFAULT_ID,
      acceptThreshold: patch.acceptThreshold ?? current?.acceptThreshold ?? 3,
      rejectThreshold: patch.rejectThreshold ?? current?.rejectThreshold ?? -6,
      minImages: patch.minImages ?? current?.minImages ?? 2,
      maxImages: patch.maxImages ?? current?.maxImages ?? 8,
      minProductLinks: patch.minProductLinks ?? current?.minProductLinks ?? 2,
      maxProductLinks: patch.maxProductLinks ?? current?.maxProductLinks ?? 10,
      ruleWeights: patch.ruleWeights ?? current?.ruleWeights ?? {},
    };
    await this.repo.save(merged);
    this.logger.log(
      `AppConfig updated: ${JSON.stringify({
        accept: merged.acceptThreshold,
        reject: merged.rejectThreshold,
        images: [merged.minImages, merged.maxImages],
        productLinks: [merged.minProductLinks, merged.maxProductLinks],
        ruleWeightOverrides: Object.keys(merged.ruleWeights).length,
      })}`,
    );
    return {
      acceptThreshold: merged.acceptThreshold,
      rejectThreshold: merged.rejectThreshold,
      minImages: merged.minImages,
      maxImages: merged.maxImages,
      minProductLinks: merged.minProductLinks,
      maxProductLinks: merged.maxProductLinks,
      ruleWeights: merged.ruleWeights,
    };
  }
}
