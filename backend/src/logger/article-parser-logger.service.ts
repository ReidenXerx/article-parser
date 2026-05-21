import {
  Injectable,
  LoggerService,
  LogLevel as NestLogLevel,
  Optional,
  Scope,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { promises as fsp } from 'fs';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import { ArticleParserScope, DecisionCategory } from './decision-categories';

/**
 * Slimmed, per-ingest decision logger.
 *
 * Replaces three concerns Sourcerer-Be solves with separate services into
 * one focused class:
 *
 *   1. NestJS `LoggerService` API (.log/.warn/.error/.debug/.verbose) so it
 *      drops in where `new Logger(SomeService.name)` is used today.
 *
 *   2. Decision API (.step / .decide / .artifact) — when called inside a
 *      `.run({ kind: 'ingest', articleId, sourceUrl })` block, structured
 *      decisions land in a per-article `.decisions.log` file under
 *      `${LOG_DIR}/ingest/`. Raw payloads (e.g. OpenAI request/response,
 *      Drive HEAD response bodies) go to a sibling artifact folder so we
 *      can post-mortem any AI call.
 *
 *   3. Cost accumulator — pipe AI-call usage into the active session so
 *      `summary()` can report total cost + token efficiency at the end of
 *      the run. Mirrors `TokenCostCalculatorService.aggregateUsage`.
 *
 * Sinks and ALS are module-level state — every instance writes to the same
 * outputs and reads from the same active session, exactly like
 * `SourcererLogger`. Construct via `new ArticleParserLogger(SomeService.name)`.
 *
 * Deliberately dropped vs Sourcerer-Be: Logfire / OpenTelemetry plumbing.
 * For a test deliverable the file-based decision log is the demo artifact;
 * full observability would be a swap-in extension.
 */

interface ActiveSession {
  scope: ArticleParserScope;
  sessionId: string;
  startedAt: number;
  stepCount: number;
  /** Buffered decisions written to disk on `end()` (or immediately, depending on env). */
  decisions: DecisionEntry[];
  /** Per-call AI usage so we can summarize cost at the end of the run. */
  usage: UsageEntry[];
  /** Directory for raw payload artifacts, lazily created. */
  artifactDir?: string;
}

interface DecisionEntry {
  ts: number;
  step?: string;
  category: DecisionCategory;
  observed: string;
  outcome: string;
  detail?: Record<string, unknown>;
}

interface UsageEntry {
  module: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

const ALS = new AsyncLocalStorage<ActiveSession>();

const LOG_LEVELS: NestLogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose'];

function colorize(level: NestLogLevel): string {
  switch (level) {
    case 'error':
      return '\x1b[31m';
    case 'warn':
      return '\x1b[33m';
    case 'debug':
      return '\x1b[36m';
    case 'verbose':
      return '\x1b[90m';
    default:
      return '\x1b[32m';
  }
}

function resetColor(): string {
  return '\x1b[0m';
}

@Injectable({ scope: Scope.TRANSIENT })
export class ArticleParserLogger implements LoggerService {
  private static enabledLevels: NestLogLevel[] = ['log', 'error', 'warn'];
  private readonly contextName: string;

  constructor(@Optional() contextName?: string) {
    this.contextName = contextName ?? 'Application';
    const level = (process.env.LOG_LEVEL ?? 'log').toLowerCase();
    if (level === 'verbose') {
      ArticleParserLogger.enabledLevels = LOG_LEVELS;
    } else if (level === 'debug') {
      ArticleParserLogger.enabledLevels = ['log', 'error', 'warn', 'debug'];
    } else if (level === 'silent') {
      ArticleParserLogger.enabledLevels = ['error'];
    }
  }

  get session(): ActiveSession | undefined {
    return ALS.getStore();
  }

  // ─── NestJS LoggerService API ────────────────────────────────────────

  log(message: any, ...optional: any[]): void {
    this.write('log', message, optional);
  }
  error(message: any, ...optional: any[]): void {
    this.write('error', message, optional);
  }
  warn(message: any, ...optional: any[]): void {
    this.write('warn', message, optional);
  }
  debug(message: any, ...optional: any[]): void {
    this.write('debug', message, optional);
  }
  verbose(message: any, ...optional: any[]): void {
    this.write('verbose', message, optional);
  }

  setLogLevels(levels: NestLogLevel[]): void {
    ArticleParserLogger.enabledLevels = levels;
  }

  private write(level: NestLogLevel, message: any, optional: any[]): void {
    if (!ArticleParserLogger.enabledLevels.includes(level)) return;

    const session = ALS.getStore();
    const tag = session
      ? `[${session.scope.articleId}]`
      : `[${this.contextName}]`;

    const stamp = new Date().toISOString().slice(11, 23);
    const color = colorize(level);

    const formatted =
      typeof message === 'string' ? message : JSON.stringify(message);

    // Suffix optional args if any — usually exception objects/stack traces.
    const suffix =
      optional.length > 0
        ? ' ' +
          optional
            .map((o) =>
              o instanceof Error
                ? o.stack ?? o.message
                : typeof o === 'string'
                  ? o
                  : JSON.stringify(o),
            )
            .join(' ')
        : '';

    // eslint-disable-next-line no-console
    console.log(
      `${color}${stamp} ${level.toUpperCase().padEnd(7)}${resetColor()} ${tag} ${formatted}${suffix}`,
    );
  }

  // ─── Decision API ────────────────────────────────────────────────────

  /**
   * Run an ingest session. All decisions/artifacts/usage logged inside
   * `fn()` are attached to this session and written to disk when `fn()`
   * resolves (success or error — the finally block always runs).
   */
  async run<T>(
    scope: ArticleParserScope,
    fn: () => Promise<T>,
  ): Promise<T> {
    const session: ActiveSession = {
      scope,
      sessionId: `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      startedAt: Date.now(),
      stepCount: 0,
      decisions: [],
      usage: [],
    };

    return ALS.run(session, async () => {
      try {
        return await fn();
      } finally {
        await this.flushSession(session);
      }
    });
  }

  /**
   * Mark the start of a pipeline step. Useful in `.decisions.log` to give
   * the reader visual chapter breaks.
   */
  step(name: string): void {
    const session = ALS.getStore();
    if (!session) return;
    session.stepCount += 1;
    session.decisions.push({
      ts: Date.now(),
      category: 'INGEST',
      observed: `--- step ${session.stepCount}: ${name} ---`,
      outcome: '',
    });
    this.log(`▶ Step ${session.stepCount}: ${name}`);
  }

  /**
   * Record a typed decision. Categories live in `decision-categories.ts` —
   * TypeScript will refuse arbitrary strings.
   */
  decide(
    category: DecisionCategory,
    observed: string,
    outcome: string,
    detail?: Record<string, unknown>,
  ): void {
    const session = ALS.getStore();
    if (!session) {
      this.log(`${category} | ${observed} → ${outcome}`);
      return;
    }
    session.decisions.push({
      ts: Date.now(),
      category,
      observed,
      outcome,
      detail,
    });
    this.log(`${category.padEnd(18)} ${observed} → ${outcome}`);
  }

  /**
   * Track AI usage so we can summarise cost / tokens at the end of the
   * session. Modules call this from inside their `executeJsonPromptWithUsage`
   * wrapper.
   */
  trackUsage(module: string, usage: Omit<UsageEntry, 'module'>): void {
    const session = ALS.getStore();
    if (!session) return;
    session.usage.push({ ...usage, module });
  }

  /**
   * Dump a raw payload to disk under the session's artifact folder. Used
   * for OpenAI request/response capture, Drive HEAD response bodies, raw
   * Doc HTML, etc. Disabled when `ARTIFACTS_ENABLED=false`.
   */
  async artifact(
    namespace: string,
    label: string,
    kind: 'req' | 'res' | 'raw',
    payload: string,
    extension: 'json' | 'html' | 'txt' = 'json',
  ): Promise<void> {
    if (process.env.ARTIFACTS_ENABLED === 'false') return;
    const session = ALS.getStore();
    if (!session) return;

    if (!session.artifactDir) {
      session.artifactDir = path.join(
        process.env.LOG_DIR ?? './logs',
        'ingest',
        `${formatTimestamp(session.startedAt)}_${session.scope.articleId}`,
        'artifacts',
      );
      await fsp.mkdir(session.artifactDir, { recursive: true });
    }

    const safe = `${namespace}_${label.replace(/[^a-z0-9-_]+/gi, '-')}_${kind}.${extension}`;
    await fsp.writeFile(path.join(session.artifactDir, safe), payload);
  }

  /**
   * Aggregate usage rolled up by model + by module — what we surface in
   * the per-article summary panel and the README "$/article" headline.
   */
  summarize(): {
    totalCost: number;
    totalTokens: number;
    totalCalls: number;
    byModel: Record<string, { calls: number; tokens: number; cost: number }>;
    byModule: Record<string, { calls: number; tokens: number; cost: number }>;
  } {
    const session = ALS.getStore();
    const usage = session?.usage ?? [];
    const byModel: Record<
      string,
      { calls: number; tokens: number; cost: number }
    > = {};
    const byModule: Record<
      string,
      { calls: number; tokens: number; cost: number }
    > = {};
    let totalCost = 0;
    let totalTokens = 0;

    for (const u of usage) {
      totalCost += u.cost;
      totalTokens += u.totalTokens;

      const m = byModel[u.model] ?? { calls: 0, tokens: 0, cost: 0 };
      m.calls += 1;
      m.tokens += u.totalTokens;
      m.cost += u.cost;
      byModel[u.model] = m;

      const mod = byModule[u.module] ?? { calls: 0, tokens: 0, cost: 0 };
      mod.calls += 1;
      mod.tokens += u.totalTokens;
      mod.cost += u.cost;
      byModule[u.module] = mod;
    }

    return {
      totalCost,
      totalTokens,
      totalCalls: usage.length,
      byModel,
      byModule,
    };
  }

  /**
   * Drop the buffered decisions to disk under `${LOG_DIR}/ingest/`.
   * Called automatically by `run()` finally-block; safe to call manually
   * from tests.
   */
  private async flushSession(session: ActiveSession): Promise<void> {
    const logDir = process.env.LOG_DIR ?? './logs';
    const sessionDir = path.join(
      logDir,
      'ingest',
      `${formatTimestamp(session.startedAt)}_${session.scope.articleId}`,
    );

    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const summary = this.summarize();
    const lines: string[] = [];
    lines.push(`# Ingest session ${session.sessionId}`);
    lines.push(`# articleId: ${session.scope.articleId}`);
    lines.push(`# sourceUrl: ${session.scope.sourceUrl}`);
    lines.push(
      `# startedAt: ${new Date(session.startedAt).toISOString()}`,
    );
    lines.push(
      `# duration:  ${Date.now() - session.startedAt}ms`,
    );
    lines.push('');

    for (const d of session.decisions) {
      const ts = `+${d.ts - session.startedAt}ms`.padStart(8);
      const cat = d.category.padEnd(18);
      const detail = d.detail ? ` | ${JSON.stringify(d.detail)}` : '';
      lines.push(`${ts}  ${cat}  ${d.observed} → ${d.outcome}${detail}`);
    }

    lines.push('');
    lines.push('# ─── Cost summary ──────────────────────────────');
    lines.push(`# total calls:  ${summary.totalCalls}`);
    lines.push(`# total tokens: ${summary.totalTokens}`);
    lines.push(`# total cost:   $${summary.totalCost.toFixed(6)}`);
    for (const [model, m] of Object.entries(summary.byModel)) {
      lines.push(
        `#   ${model.padEnd(20)} calls=${m.calls} tokens=${m.tokens} cost=$${m.cost.toFixed(6)}`,
      );
    }

    await fsp.writeFile(
      path.join(sessionDir, 'decisions.log'),
      lines.join('\n'),
    );
  }
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '_',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}
