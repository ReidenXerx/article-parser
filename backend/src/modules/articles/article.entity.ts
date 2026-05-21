import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ExtractedFormattingAudit,
  ExtractedImage,
  ExtractedLink,
  ExtractedMetaFields,
} from '../extractors/extracted-article.types';
import { QualityReport } from '../quality-gate/types';

/**
 * Persisted article row.
 *
 * We use `simple-json` for the structured fields so the same entity
 * works on SQLite (test / demo) and PostgreSQL (production) without
 * driver-specific code. The trade-off vs native jsonb is that we can't
 * query inside the JSON columns — for an editorial dashboard that's
 * fine, but we'd switch to `jsonb` + GIN indexes if the QA team needs
 * "show me all articles where image.drivePrivate fired" queries later.
 */
@Entity({ name: 'articles' })
export class Article {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  sourceUrl!: string;

  @Index()
  @Column({ type: 'text' })
  docId!: string;

  /** `'public-export' | 'docs-api'` — which fetch path served the doc. */
  @Column({ type: 'text' })
  ingestMode!: string;

  @Column({ type: 'simple-json' })
  meta!: ExtractedMetaFields;

  @Column({ type: 'text' })
  bodyClean!: string;

  @Column({ type: 'text' })
  bodyRaw!: string;

  @Column({ type: 'simple-json' })
  images!: ExtractedImage[];

  @Column({ type: 'simple-json' })
  links!: ExtractedLink[];

  @Column({ type: 'simple-json' })
  formatting!: ExtractedFormattingAudit;

  @Column({ type: 'simple-json' })
  qualityReport!: QualityReport;

  /** Sum of AI cost across every extractor + the validity gate. USD. */
  @Column({ type: 'real', default: 0 })
  totalCost!: number;

  /** Optional ID returned by the publisher after a successful upload. */
  @Column({ type: 'text', nullable: true })
  publishedId!: string | null;

  /** `'wordpress' | 'shopify' | null` — which publisher ran. */
  @Column({ type: 'text', nullable: true })
  publishedTo!: string | null;

  @Column({ type: 'datetime', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
