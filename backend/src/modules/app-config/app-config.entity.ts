import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Singleton row holding runtime-tunable quality-gate config.
 *
 * Always identified by `id='default'` — there's no multi-tenant story
 * yet; per-client rule profiles are a `FUTURE.md` item. Storing the
 * config in the DB (not just env) lets editors flip thresholds in the
 * settings UI without a server restart, which is the whole "configurable
 * quality coefficient" the brief implies.
 */
@Entity({ name: 'app_config' })
export class AppConfig {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'integer' })
  acceptThreshold!: number;

  @Column({ type: 'integer' })
  rejectThreshold!: number;

  @Column({ type: 'integer' })
  minImages!: number;

  @Column({ type: 'integer' })
  maxImages!: number;

  @Column({ type: 'integer' })
  minProductLinks!: number;

  @Column({ type: 'integer' })
  maxProductLinks!: number;

  /**
   * Per-rule weight overrides keyed by rule name. Empty object = use
   * every rule's hard-coded default weight.
   */
  @Column({ type: 'simple-json' })
  ruleWeights!: Record<string, number>;

  @UpdateDateColumn()
  updatedAt!: Date;
}
