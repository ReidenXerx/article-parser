# Architecture

This is a deeper layer-by-layer walkthrough of the design. Aimed at the engineer who'd own the codebase next.

The system follows the same **layered quality-gate pattern** that `Sourcerer-Be` uses for event extraction: cheap deterministic checks first, escalate to AI second-opinion only on borderline cases, with structured decision logging and cost tracking throughout. Most of the modules here are 1:1 ports or close adaptations of services in `Sourcerer-Be`, retuned for editorial article parsing instead of event/news extraction.

## Layer overview

```
                                              ┌──────────────────────────┐
                                              │  Next.js frontend (3000) │
                                              │                          │
                                              │  / · ingest               │
                                              │  /articles                │
                                              │  /articles/[id]           │
                                              │  /settings                │
                                              └────────────┬─────────────┘
                                                           │ JSON over HTTP
                                                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  NestJS backend (3001)                                                 │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  ArticleIngestionService — the orchestrator                       │ │
│  │                                                                  │ │
│  │  step 1: Fetch (GoogleDocsService — cascade)                     │ │
│  │  step 2: Run 5 extractors in parallel                            │ │
│  │            ─ meta-fields                                         │ │
│  │            ─ body-html                                           │ │
│  │            ─ image-inventory                                     │ │
│  │            ─ link-inventory                                      │ │
│  │            ─ formatting-audit                                    │ │
│  │  step 3: Drive HEAD probe (concurrency-capped)                   │ │
│  │  step 4: Image relevance vision check (opt-in)                   │ │
│  │  step 5: Quality gate                                            │ │
│  │            ─ deterministic scorer (assessArticleQuality)         │ │
│  │            ─ AI second-opinion (on `escalate` only)              │ │
│  │  step 6: Persist (TypeORM ─ SQLite or PostgreSQL)                │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌──────────────────────────────┐  ┌────────────────────────────────┐ │
│  │  PublishersController         │  │  AppConfigController            │ │
│  │  POST /publish/wordpress       │  │  GET /api/app-config            │ │
│  │  POST /publish/shopify         │  │  PUT /api/app-config            │ │
│  └──────────────────────────────┘  └────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌──────────────┐    ┌──────────────────────┐
                    │  SQLite /    │    │  logs/ingest/        │
                    │  PostgreSQL  │    │     {ts}_{articleId}/ │
                    │              │    │       decisions.log   │
                    │  articles    │    │       artifacts/      │
                    │  app_config  │    │         openai_*_req.json
                    └──────────────┘    │         openai_*_res.json
                                        │         gdocs_*_raw.html
                                        └──────────────────────┘
```

## Why a layered gate (not just "ask the AI")?

Three reasons:

1. **Cost.** A pure-AI gate costs ~$0.005-0.02 per article in tokens at scale. A deterministic-first gate costs $0 for accept/reject verdicts (~80% of cases) and ~$0.0002 only on borderline cases. Across thousands of ingests, that's a ~30x cost ratio.

2. **Auditability.** Editors need to see *why* an article was rejected. Rules with named hits (`image.drivePrivate`, `fmt.multipleH1`) are self-documenting; a single "the AI said reject" line is not. The `decisions.log` artifact is the human-readable receipt.

3. **Determinism on the common case.** A clearly-good or clearly-bad article should land on the same verdict every time. Deterministic rules do this. AI inference is non-deterministic by nature, so we route only the genuinely ambiguous middle band to it.

## Module-by-module

### `logger/article-parser-logger.service.ts`

NestJS `LoggerService` + a `decide` / `step` / `artifact` API + an AsyncLocalStorage-scoped session. One service handles three concerns Sourcerer-Be splits across three (`SourcererLogger`, `DecisionLog`, `ArtifactStore`) &mdash; deliberate slim-down for a 1-engineer codebase.

The `run({ kind: 'ingest', articleId, sourceUrl }, async () => …)` API is what makes per-article decision logs possible. Every `logger.decide()` and `logger.artifact()` call inside the `async` body lands in the same session bucket; the finally-block flushes to disk.

Decision categories live in `decision-categories.ts` as a typed union &mdash; TypeScript refuses arbitrary category strings, which protects the log against typos and keeps `grep CATEGORY *.log` reliable.

### `modules/openai/`

Ported almost verbatim from `Sourcerer-Be/src/modules/openai/`. Three classes:

- **`TokenCostCalculatorService`** &mdash; per-model pricing table, `aggregateUsage` rollups.
- **`OpenAIService`** &mdash; the thin wrapper around the openai SDK. Retry on 429 / 5xx, strip `temperature` for GPT-5 / o1 / o3 reasoning models (HTTP 400 guard), boot-tolerant (no `OPENAI_API_KEY` &rarr; warns at construction, throws at call time).
- **`OpenAIPromptService`** &mdash; the API the rest of the codebase actually depends on. `executeJsonPromptWithUsage`, `executeVisionJsonPromptWithUsage`. JSON repair on truncated/malformed responses. Usage tracking piped into the active logger session.

### `modules/google-docs/`

`GoogleDocsService.fetch(urlOrId)` runs a two-step cascade:

1. **Public export** &mdash; `GET https://docs.google.com/document/d/{id}/export?format=html`. Inspects the response for "ServiceLogin" / "accounts.google.com" markers to detect a login redirect (the API returns 200 even for private docs, with a login HTML body). Costs nothing.

2. **Drive API fallback** &mdash; `drive.files.export(fileId, mimeType='text/html')` via a service-account key. Same HTML shape as the public export. Only runs if `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` is configured.

Both paths dump the raw HTML to the session artifact folder so we can post-mortem ingestion bugs without re-fetching.

### `modules/drive/`

The `DriveService` does two things: extract a Drive file ID from any of the URL shapes writers paste, and HEAD-probe a direct-view URL to verdict the file's public accessibility.

The HEAD-probe approach is a deliberate choice over a Drive API permission check:

- **No service-account setup.** Works out of the box.
- **Same fetch path the eventual published article reader takes.** An anonymous browser hitting a Drive image is exactly what we simulate.
- **Zero quota cost.** Drive API permission reads consume daily quota; HEAD requests don't.

Verdict mapping:
- 200 with `image/*` content-type &rarr; **public**
- 200 with `text/html` (Drive's login page) &rarr; **private**
- 401 / 403 &rarr; **private**
- 404 &rarr; **unknown** (file might exist but URL is wrong)
- Network error / other status &rarr; **unknown** (fail-open)

Batched with a concurrency cap of 4 so a dense article doesn't burst Google with 20 simultaneous requests.

### `modules/extractors/`

Five extractors, each implementing `EnhancedExtractionModule<T>` (`{ name, extractWithUsage(html, context) }`). The interface is ported from Sourcerer-Be's `EnhancedExtractionModule<T>` &mdash; same shape, same usage-tracking contract.

Two of the five extractors are **fully deterministic** (`body-html`, `formatting-audit`, `link-inventory`, `image-inventory`) and return `createEmptyUsage()`. Only `meta-fields` makes an AI call, and only when the regex pass misses BOTH meta annotations. This keeps the ingest path cheap by default.

#### Why per-paragraph regex for meta fields?

Google's HTML export collapses whitespace inside paragraphs, so `body.textContent` returns a single newline-free string. A greedy `Meta Title:(.+?)(?:newline|end)` regex on that string captures everything until the end of the document &mdash; not the next line. The fix is to walk `<p>` elements and check each one's trimmed text content individually. The annotation lives in its own paragraph in every Google Docs export we've seen.

### `modules/quality-gate/`

The heart of the system. Three files:

- **`types.ts`** — `Rule`, `RuleHit`, `DeterministicVerdict`, `QualityReport`, `AssessmentInput`, `QualityGateConfig`.
- **`article-validity.util.ts`** &mdash; the pure scorer. `assessArticleQuality(input, cfg)` runs every rule, sums weights, decides accept / reject / escalate. **Pure function** &mdash; no DB, no HTTP, fully unit-testable.
- **`article-validity.service.ts`** &mdash; the orchestrator. Runs the scorer; on `escalate`, runs the AI second-opinion; merges the verdicts; falls open if the AI errors.

Rules are organised by family in `rules/{image,link,formatting}.rules.ts`. Each rule is `(input, cfg) => RuleHit[]` &mdash; zero or more hits. Adding a rule is appending one arrow function.

Weight overrides go through `weightFor(cfg, name, defaultWeight)` &mdash; the AppConfigModule provides `cfg.ruleWeights[name]` overrides, the rule's hard-coded default is the fallback. This is what lets the Settings page tweak any rule's weight without code changes.

#### The AI second-opinion prompt

Lives inline in `article-validity.service.ts`. Receives:
- The full rule findings (rule name + weight + matched detail)
- The article meta (title / meta title / meta description)
- Stats (word count, image count, product link count, heading outline)
- The first 3000 chars of the cleaned body

Returns JSON `{ verdict: "accept" | "reject", reasoning: string }`. The prompt is explicit that the AI is the *tiebreaker* &mdash; not a re-implementation of the rule layer.

### `modules/articles/`

`ArticleIngestionService` is the orchestrator. Reading top-to-bottom you can see the whole pipeline; reading `decisions.log` for any ingest, you can see the same six steps in chronological order with their outputs.

The `image-relevance.service.ts` is the stretch feature: opt-in per-image vision check using `executeVisionJsonPromptWithUsage`. Off by default; flip `IMAGE_RELEVANCE_CHECK_ENABLED=true` to enable.

### `modules/publishers/`

`Publisher` interface, two implementations. Both follow the same contract:

- Build a `PublishPayload` (publisher-agnostic shape with title, meta title, meta description, body HTML, image list).
- If `MOCK_UPLOAD=true` (the default), echo the payload back as a successful mock result &mdash; this is the "static button that triggers a placeholder automation" the brief asks for.
- If real credentials are configured, POST to WordPress's REST API (`/wp-json/wp/v2/posts`) or Shopify's blog articles endpoint.
- Always log the publish intent through `logger.decide('PUBLISH', ...)` so the audit log captures what would (or did) ship.

The gate-enforcement happens at the **controller** layer: `PublishersController.publish` checks `article.qualityReport.finalDecision === 'accept'` and rejects with a 400 unless `force=true` is in the body. This is the editor's "override the gate" path &mdash; logged, but allowed.

### `modules/app-config/`

`AppConfigModule` is a `@Global()` module with a singleton row in the DB.

`OnApplicationBootstrap` seeds the singleton from env on first boot. Thereafter the runtime config is the source of truth; `PUT /api/app-config` mutates it without restart.

`ArticleValidityService.assess()` reads config through `AppConfigService.get()` (not env) so changes take effect on the next ingest. Tests can pass a `cfgOverride` parameter.

## Data flow per ingest

```
sourceUrl
   │
   ▼  GoogleDocsService.fetch()
{ docId, html, mode }
   │
   ▼  parallel extractors
{ meta, bodyHtml, images, links, formatting }
   │
   ▼  DriveService.checkBatch(image.rawUrl)
images.map(img => ({ ...img, drive }))
   │
   ▼  assembled ExtractedArticle
{ sourceUrl, docId, meta, body, images, links, formatting }
   │
   ▼  ImageRelevanceService.checkBatch (stretch, opt-in)
imageRelevance: ImageRelevanceVerdict[]
   │
   ▼  ArticleValidityService.assess()
{ deterministic: { decision, score, rules }, ai?, finalDecision }
   │
   ▼  Article entity persisted via TypeORM
{ id, ...extracted, qualityReport, totalCost }
```

Every step contributes structured lines to `logger.decide(...)`. On finish, the session logger flushes `decisions.log` to disk and totals `byModel` / `byModule` cost summaries.

## Deliberate non-decisions (kept for FUTURE.md)

- No multi-tenant config &mdash; one global AppConfig row.
- No image-binary upload to WordPress media library &mdash; the publisher logs intent ("would fetch from Drive and embed `<img>`") but doesn't actually do it.
- No retry queue / DLQ for failed ingests &mdash; errors propagate up to the HTTP layer.
- No frontend auth &mdash; assumes a trusted editorial environment.
- No semantic dedup across ingested articles &mdash; Sourcerer-Be has this; we'd port the pattern when traffic merits.
- No migration files &mdash; `synchronize: true` is fine for a test deliverable, would switch to explicit migrations for production (Sourcerer-Be has 80+).

See [`FUTURE.md`](./FUTURE.md) for the prioritised backlog of next steps.
