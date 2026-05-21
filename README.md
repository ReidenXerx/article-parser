# Article Parser

A production-grade ingestion pipeline for editorial Google Docs &rarr; quality-gated WordPress / Shopify publishing.

Built around a **layered quality gate**:

1. **Five focused extractors** read the doc once and produce a typed `ExtractedArticle` shape.
2. **A deterministic, weighted-rule scorer** decides `accept` / `reject` / `escalate` &mdash; tunable thresholds, ~25 rules in three families (image, link, formatting).
3. **An AI second-opinion** fires only on `escalate` verdicts, with a fail-open fallback to a deterministic tiebreak if the AI call errors.
4. **A per-article decision log** captures every rule firing, every AI call, and the exact cost (USD) so an editor can audit any verdict after the fact.

Mirrors the architecture pattern from [Sourcerer-Be's](https://github.com/) event-validity service: cheap-then-fall-back, configurable weights, structured decisions, cost-tracked AI.

---

## Demo target

The brief's test doc lives at:

```
https://docs.google.com/document/d/1syYirDYpa8B4SoT3ITYeknDvQmdIeuFq5QW7WmbEVVc/edit
```

Pre-filled in the homepage ingest form. Pipeline is doc-agnostic &mdash; any public Google Doc URL works.

## Quick start

```bash
# 1. Backend
cd backend
cp .env.example .env
# add OPENAI_API_KEY=sk-... to .env to enable AI fallbacks
npm install
npm run start:dev            # http://localhost:3001 + Swagger at /docs

# 2. Frontend
cd ../frontend
cp .env.local.example .env.local
npm install
npm run dev                  # http://localhost:3000
```

Visit `http://localhost:3000`, paste the demo URL (it's pre-filled), click **Ingest article**.

### CLI ingest (no UI)

```bash
cd backend
npm run ingest -- "https://docs.google.com/document/d/.../edit"
```

Prints the per-article report; writes the cleaned WordPress HTML to `logs/ingest-output/{articleId}.html`; writes a structured decision log to `logs/ingest/{ts}_{articleId}/decisions.log`.

## What the pipeline does, end to end

1. **Fetch** the Google Doc HTML.
   - Try the public `?format=html` export endpoint first (zero auth, works for "anyone with link can view" docs).
   - Fall back to Drive API `files.export` with a service-account key if the doc is private (set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`).

2. **Extract** five slices of the article in parallel:
   - `meta-fields` &mdash; per-paragraph regex for `Meta Title:` / `Meta Description:` annotations; AI fallback when both miss.
   - `body-html` &mdash; sanitize for WordPress; unwrap Google redirect URLs; strip Yoast annotation paragraphs.
   - `image-inventory` &mdash; recognise embedded `<img>` AND placeholder-link patterns (`<a href="drive...">IMAGE 1</a>` + nearby `Alt tag: "..."`).
   - `link-inventory` &mdash; classify as `product` / `brand` / `internal` / `external` / `image-placeholder`. Host + path patterns are env-configurable.
   - `formatting-audit` &mdash; H1 count, heading hierarchy, paragraph counts, word count, missing-alt count.

3. **HEAD-probe** every image URL against Drive's direct-view endpoint:
   - `public` &mdash; 200 OK with `image/*` content-type.
   - `private` &mdash; 200 OK with `text/html` (Drive login page) or 401/403.
   - `not-drive` &mdash; URL didn't match any known Drive pattern.
   - `unknown` &mdash; network error or unexpected status (fail-open).

   In parallel, **GET-probe** every body link to catch broken / soft-404 URLs (Range-limited to 10KB for body inspection):
   - `ok` &mdash; 2xx + no 404 markers in title / first H1.
   - `hard-4xx` &mdash; server returned 4xx (most common cause: removed product page).
   - `soft-404` &mdash; 200 OK but redirected to homepage / known-404 path, OR title / H1 contains 404 phrasings (Shopify, WP, Wix patterns covered).
   - `hard-5xx` &mdash; server error (lighter weight; often transient).
   - `unreachable` &mdash; network error / DNS / SSL (lighter weight; fail-open).
   - `redirect` &mdash; followed a redirect that resolved OK (informational only).

4. **Score** the article through the weighted rule layer.
   - Each rule contributes a signed integer hit.
   - Sum &ge; `acceptThreshold` &rarr; **accept**. Sum &le; `rejectThreshold` &rarr; **reject**. Otherwise &rarr; **escalate**.
   - Thresholds + per-rule weights are runtime-tunable through `PUT /api/app-config`.

5. **AI second-opinion** when `escalate`:
   - One prompt to `gpt-5-mini` (default; configurable via `ARTICLE_VALIDITY_MODEL`).
   - Receives the rule findings, meta, stats, and the body excerpt.
   - Returns `accept` | `reject` with a &le;200-char reasoning blurb.
   - Fail-open: falls back to deterministic score-sign tiebreak if the AI errors.

6. **Persist** the full result (article + rules + AI verdict + cost) to SQLite (default) or PostgreSQL (`DB_TYPE=postgres`).

7. **Publish** to WordPress / Shopify (mocked behind `MOCK_UPLOAD=true` until real credentials are wired in).
   - Gate blocks publishes unless the verdict is `accept` &mdash; `force=true` override is logged.

## What the system caught on the demo doc

A real, unaltered run against the brief's test document:

| Rule | Weight | Match |
|---|---:|---|
| `image.healthyCount` | +1 | 3 images (band: 2-8) |
| `image.drivePrivate` | -4 | 3 Drive image(s) not publicly accessible |
| `image.altCoverageFull` | +1 | all 3 images have alt text |
| `links.productHealthyCount` | +1 | 10 product links (band: 2-10) |
| **`links.hard4xx`** | **-4** | **6 link(s) returned 4xx (e.g. 404 for `https://www.andar.com/products/the-dog-collar`)** |
| **`fmt.multipleH1`** | **-2** | **2 H1 headings (should be exactly 1) &mdash; real bug in the article's Conclusion section** |
| `fmt.metaTitleOk` | +1 | Meta Title present (53 chars) |
| `fmt.metaDescOk` | +1 | Meta Description present (144 chars) |

Score: **−5** &rarr; escalate &rarr; AI: **reject** with reasoning *"Private Drive images (3), six product links return 4xx, and there are multiple H1s. Fix broken links, make images public, and use a single H1."* &rarr; final: **reject**. Total cost: **$0.00116** (1,574 tokens, 1 call).

Three real bugs caught on the demo doc itself:
- The Conclusion section was wrongly styled with `<h1>` instead of `<h2>` &mdash; the deterministic `fmt.multipleH1` rule fires.
- All three Drive images are not publicly shared &mdash; the HEAD probe catches them as `private`.
- Six product links return HTTP 404 &mdash; the link reachability probe catches them as `hard-4xx` with the exact URL surfaced in the audit panel.

## Configuration

Thresholds and per-rule weights are tunable at runtime through the Settings page (or `PUT /api/app-config`). Defaults seed from `backend/.env` on first boot. See `backend/.env.example` for the full list.

| Knob | Default | Effect |
|---|---:|---|
| `QUALITY_ACCEPT_THRESHOLD` | 3 | Score &ge; this &rarr; auto-accept |
| `QUALITY_REJECT_THRESHOLD` | -6 | Score &le; this &rarr; auto-reject |
| `QUALITY_MIN_IMAGES` | 2 | Below = `image.tooFew` (-4) |
| `QUALITY_MAX_IMAGES` | 8 | Above = `image.tooMany` (-2) |
| `QUALITY_MIN_PRODUCT_LINKS` | 2 | Below = `links.productTooFew` (-3) |
| `QUALITY_MAX_PRODUCT_LINKS` | 10 | Above = `links.productTooMany` (-2) |
| `QUALITY_PRODUCT_PATH_PATTERNS` | `/products/,/collections/,/product/,/shop/` | Comma-separated path patterns for product link detection |

## REST API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/articles/ingest` | Ingest a Google Doc URL or ID. Returns `{ articleId, finalDecision, score, cost, rules }`. |
| `GET` | `/api/articles` | List ingested articles (newest first). |
| `GET` | `/api/articles/:id` | Full article record + quality report. |
| `POST` | `/api/articles/:id/publish/wordpress` | Publish (mocked unless `MOCK_UPLOAD=false`). `{ force?: boolean }` overrides reject. |
| `POST` | `/api/articles/:id/publish/shopify` | Publish to Shopify. |
| `GET` | `/api/app-config` | Current quality-gate config. |
| `PUT` | `/api/app-config` | Update thresholds / per-rule weights at runtime. |

Swagger UI: `http://localhost:3001/docs`

## Repository layout

```
article-parser/
├── README.md                  this
├── ARCHITECTURE.md            deeper layer-by-layer explanation
├── FUTURE.md                  feature ideas not in this MVP
├── docker-compose.yml         production-grade Postgres for DB_TYPE=postgres
├── backend/                   NestJS API + pipeline
│   ├── src/
│   │   ├── logger/                       Per-ingest decision log + ALS scope + cost summary
│   │   ├── modules/
│   │   │   ├── openai/                   Prompt service + cost calculator (ported from Sourcerer-Be)
│   │   │   ├── google-docs/              Cascade fetcher: public export → Drive API fallback
│   │   │   ├── drive/                    File-id parser + HEAD-probe (public/private/not-drive/unknown)
│   │   │   ├── extractors/               EnhancedExtractionModule<T> implementations
│   │   │   ├── quality-gate/             Rule layer + AI second-opinion + AppConfig-driven thresholds
│   │   │   ├── articles/                 Ingestion orchestrator + persistence + image-relevance stretch
│   │   │   ├── publishers/               WordPress + Shopify (mocked by default)
│   │   │   └── app-config/               Runtime-tunable thresholds + per-rule weights
│   │   └── main.ts
│   └── scripts/ingest.ts                 CLI for the demo flow
└── frontend/                   Next.js App Router
    ├── app/
    │   ├── page.tsx                      Ingest form
    │   ├── articles/page.tsx             List
    │   ├── articles/[id]/page.tsx        Article view (meta cards + audit + publish + body)
    │   └── settings/page.tsx             Tunable thresholds & rule weights
    └── components/                       Audit panel, publish buttons, etc.
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design-decision walkthrough and [`FUTURE.md`](./FUTURE.md) for the next-step backlog.

## Production-grade choices on display

- **Layered architecture &mdash; cheap deterministic rules first, AI only on borderline cases.** Mirrors the pattern from `Sourcerer-Be`'s event-validity gate. ~$0.0002 per ingest, predictable.
- **Configurable quality coefficient &mdash; runtime-tunable thresholds + per-rule weight overrides.** Editor team tunes strictness without engineering involvement.
- **Per-article decision log written to disk.** Every rule firing, every AI verdict, every cost figure &mdash; auditable after the fact. Lives at `backend/logs/ingest/{ts}_{articleId}/decisions.log`.
- **Cost-tracked AI calls.** Each call adds to a per-article ledger; the UI surfaces total cost in the audit panel.
- **Fail-open semantics.** If the AI second-opinion errors, the deterministic score breaks the tie &mdash; the pipeline NEVER silently blocks an article over a flaky network call.
- **Environment-agnostic persistence.** SQLite (zero-setup) by default, swap to PostgreSQL via a single env var (`DB_TYPE=postgres`) for production.
- **Boot-tolerant AI module.** Missing `OPENAI_API_KEY` doesn't crash the app &mdash; deterministic pipeline still runs end-to-end, AI fallbacks throw a clear error at call time.
- **Modular extractor pattern.** Adding a new extractor (e.g. "tone of voice", "keyword density") is a single class implementing `EnhancedExtractionModule<T>` &mdash; orchestrator picks it up automatically.

## Stretch feature: image-relevance vision check

Set `IMAGE_RELEVANCE_CHECK_ENABLED=true` in `backend/.env` to opt into a per-image vision check. For each publicly-accessible image, `IMAGE_RELEVANCE_MODEL` (defaults to `gpt-4o-mini`) receives the image + surrounding section text and returns `relevant: true | false`. Surfaces as informational badges in the audit panel; not (yet) wired into the rule layer. ~$0.0001-0.0003 per image.

> The vision model is **decoupled** from `OPENAI_MODEL_MINI` because the default mini (`gpt-5-mini`) is a reasoning model that doesn't accept vision inputs. The vision feature picks its own model so flipping the enable flag Just Works — no editor needs to remember which mini supports images.
