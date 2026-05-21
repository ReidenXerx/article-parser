import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { ArticleParserLoggerModule } from './logger/article-parser-logger.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { PublishersModule } from './modules/publishers/publishers.module';

/**
 * Resolve TypeORM datasource options from env.
 *
 * Two paths:
 *   - DB_TYPE=sqlite (default) — file-based, zero-setup. The data file
 *     lives at `DB_PATH` (default `./data/article-parser.sqlite`). We
 *     create the parent directory on boot so a fresh clone works without
 *     manual mkdir.
 *
 *   - DB_TYPE=postgres — standard POSTGRES_* env vars. Production mode;
 *     `docker-compose up -d` brings the matching container up locally.
 *
 * Both paths use TypeORM's `synchronize: true` for the test deliverable.
 * In production we'd switch to explicit migrations (Sourcerer-Be has 80+).
 */
function buildTypeOrmOptions(config: ConfigService): any {
  const dbType = (config.get<string>('DB_TYPE') ?? 'sqlite').toLowerCase();

  if (dbType === 'postgres') {
    return {
      type: 'postgres',
      host: config.get<string>('POSTGRES_HOST') ?? 'localhost',
      port: Number(config.get<string>('POSTGRES_PORT') ?? 5432),
      username: config.get<string>('POSTGRES_USER') ?? 'postgres',
      password: config.get<string>('POSTGRES_PASSWORD') ?? 'postgres',
      database: config.get<string>('POSTGRES_DB') ?? 'article_parser',
      autoLoadEntities: true,
      synchronize: true,
      ssl:
        process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false,
    };
  }

  const dbPath = config.get<string>('DB_PATH') ?? './data/article-parser.sqlite';
  mkdirSync(dirname(dbPath), { recursive: true });

  return {
    type: 'better-sqlite3',
    database: dbPath,
    autoLoadEntities: true,
    synchronize: true,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 200 }]),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
      inject: [ConfigService],
    }),

    ArticleParserLoggerModule,
    AppConfigModule,
    ArticlesModule,
    PublishersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
