/**
 * End-to-end ingest CLI for local development & smoke testing.
 *
 * Usage:
 *   npm run ingest -- <google-doc-url-or-id>
 *
 * Prints a summary line + dumps the produced WordPress-clean HTML +
 * the quality-report rules table. Same code path the REST API uses —
 * just no HTTP layer, so it's the fastest way to iterate on rules.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ArticleIngestionService } from '../src/modules/articles/article-ingestion.service';
import { promises as fsp } from 'fs';
import path from 'path';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npm run ingest -- <google-doc-url-or-id>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ingestion = app.get(ArticleIngestionService);
    const result = await ingestion.ingest(arg);

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  Article quality report');
    console.log('══════════════════════════════════════════════════════');
    console.log(`Article ID:        ${result.article.id}`);
    console.log(`Doc ID:            ${result.article.docId}`);
    console.log(`Ingest mode:       ${result.article.ingestMode}`);
    console.log(`Article title:     ${result.article.meta.articleTitle}`);
    console.log(`Meta title:        ${result.article.meta.metaTitle ?? '(missing)'}`);
    console.log(`Meta description:  ${result.article.meta.metaDescription ?? '(missing)'}`);
    console.log('');
    console.log(`Word count:        ${result.article.formatting.wordCount}`);
    console.log(`Images:            ${result.article.images.length}`);
    console.log(`Links:             ${result.article.links.length}`);
    console.log('');
    console.log(`Deterministic score: ${result.article.qualityReport.deterministic.score}`);
    console.log(`Deterministic verdict: ${result.article.qualityReport.deterministic.decision}`);
    if (result.article.qualityReport.ai) {
      console.log(`AI verdict: ${result.article.qualityReport.ai.verdict} — ${result.article.qualityReport.ai.reasoning}`);
    }
    console.log(`Final decision:    ${result.article.qualityReport.finalDecision}`);
    console.log('');
    console.log('Rules fired:');
    for (const r of result.article.qualityReport.deterministic.rules) {
      const sign = r.weight >= 0 ? '+' : '';
      console.log(`  ${sign}${r.weight}\t${r.name}\t${r.matched}`);
    }
    console.log('');
    console.log(`Total cost:        $${result.costSummary.totalCost.toFixed(6)}`);
    console.log(`Total tokens:      ${result.costSummary.totalTokens}`);
    console.log(`Total calls:       ${result.costSummary.totalCalls}`);
    console.log('Cost by module:');
    for (const [mod, m] of Object.entries(result.costSummary.byModule)) {
      console.log(
        `  ${mod.padEnd(20)} calls=${m.calls} tokens=${m.tokens} cost=$${m.cost.toFixed(6)}`,
      );
    }

    // Dump the produced WordPress-clean HTML next to the decision log
    const outDir = path.join(
      process.env.LOG_DIR ?? './logs',
      'ingest-output',
    );
    await fsp.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${result.article.id}.html`);
    await fsp.writeFile(outPath, result.article.bodyClean);
    console.log(`\nProduced HTML written to: ${outPath}\n`);
  } catch (err) {
    console.error('Ingest failed:', err);
    process.exitCode = 2;
  } finally {
    await app.close();
  }
}

void main();
