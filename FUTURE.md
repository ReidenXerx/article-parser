# FUTURE.md

Features intentionally left out of the MVP, in roughly the order I'd build them next.

Each entry includes a short rationale (why it'd be valuable) and a rough implementation sketch (how I'd actually wire it in).

---

## A. Publishing pipeline depth

### A1. Drive-image binary upload to WordPress media library
**Today:** placeholder anchors in the body link to Drive. The published article still shows "IMAGE 1" instead of an actual image.
**Plan:** in the WordPress publisher's pre-publish step, iterate over each `placeholder-link` image, fetch the binary from `https://drive.google.com/uc?export=download&id={fileId}` (with the service-account key when needed), POST it to `/wp-json/wp/v2/media`, then string-replace the placeholder anchor in the body HTML with a real `<img src="{media-url}" alt="{altText}">`. The cleaned body is what gets shipped.
**Effort:** ~3 hours including idempotency (don't re-upload on retries).

### A2. Shopify equivalent
**Plan:** same pattern as A1 but POSTing image data URIs (or upload to Files API) to Shopify's blog articles endpoint as an inline image. Shopify allows base64-encoded image data in `body_html`; for files larger than ~1MB we'd use the Files API + reference the URL.
**Effort:** ~2 hours.

### A3. Real OAuth flow for WordPress
**Today:** Basic auth with an Application Password.
**Plan:** swap to WordPress's OAuth1 / Site Health Application Password flow with refresh tokens. Worth it if we're publishing to multiple sites; trivial for single-site use cases.
**Effort:** ~4 hours.

### A4. Publish retry queue with backoff
**Plan:** add a `publishes` table + a BullMQ-backed queue. The publish endpoint enqueues; a worker drains with exponential backoff. Failed publishes after N retries land in a DLQ with the full payload echo for manual recovery.
**Effort:** ~6 hours including dashboard.

---

## B. Quality-gate depth

### B1. Per-client rule profiles (multi-tenant config)
**Today:** one global `AppConfig` singleton.
**Plan:** change the singleton to `{ id, clientId, ...config }`. The ingest payload gets an optional `clientId`; the validity service loads that client's config. Default profile covers the common case.
**Effort:** ~3 hours.

### B2. Rule profile presets
**Plan:** ship a small set of named presets ("strict SEO", "lenient editorial", "image-heavy review", etc.) selectable from the Settings UI &mdash; behind the scenes they're just stored configs. Switching profile is one click; tweaking from a preset persists the diff.
**Effort:** ~2 hours.

### B3. AI second-opinion on `accept` AND `reject` borderline (within 1 of threshold)
**Today:** AI only fires on `escalate`.
**Plan:** if the score is within `±1` of either threshold, also fire the AI. Captures "we *barely* accepted this but the AI would have caught a problem" cases. Configurable per profile.
**Effort:** ~1 hour.

### B4. Headline-rewrite suggestion
**Plan:** when `fmt.metaTitleTooLong` or `fmt.metaDescTooLong` fires, add a small AI call that proposes a tighter rewrite. Returns 3 options sorted by length; editor can copy-paste straight into Google Docs.
**Effort:** ~2 hours including UI.

### B5. Tone-of-voice rule
**Plan:** an AI rule that checks whether the article matches a per-client brand voice (provided as a 1-paragraph descriptor in the AppConfig). Returns a 0-1 score; weight contributes to the gate the usual way.
**Effort:** ~3 hours.

### B6. Keyword density / search-intent alignment
**Plan:** given a target search keyword (passed via the ingest payload or guessed from the meta title), check density, placement (H1/H2/first paragraph), and external link relevance. SEO teams love this.
**Effort:** ~4 hours.

### B7. Deterministic plagiarism scan
**Plan:** chunk the article into 5-sentence windows, hash each, check against a Postgres GIN-indexed `article_chunk_hash` table. Catches direct copy-paste between articles by the same writer team. **No external API** &mdash; this is the Sourcerer-Be content-hash dedup pattern reapplied.
**Effort:** ~6 hours.

---

## C. Image quality depth

### C1. Image-relevance vision check &rarr; rule layer
**Today:** stretch feature surfaces as informational badges only.
**Plan:** add an `image.irrelevant` rule weighted at -2 per irrelevant image, capped at the count or -6 total. Wires the vision verdict into the gate.
**Effort:** ~1 hour.

### C2. Image-dimension / aspect-ratio check
**Plan:** fetch each image's dimensions (HEAD + content-length sniff, or actual fetch with `image-size` lib). Flag images smaller than 1200x800 or with weird aspect ratios &mdash; common signal of a thumbnail accidentally used as a hero.
**Effort:** ~2 hours.

### C3. Image-duplicate detection across the article
**Plan:** perceptual-hash every image, flag pairs with hash distance &le; 5. Catches the "writer pasted the same image twice" mistake.
**Effort:** ~3 hours.

### C4. Auto-compress / convert images before WordPress upload
**Plan:** wire `sharp` into the binary-upload step from A1. WebP conversion + 85% quality reduces published asset size dramatically.
**Effort:** ~2 hours.

---

## D. Extraction depth

### D1. Notion ingestion source
**Plan:** add a `NotionService` mirroring `GoogleDocsService.fetch(urlOrId)` &mdash; same `{ html, mode }` return shape. The whole extractor + gate pipeline runs unchanged downstream.
**Effort:** ~4 hours.

### D2. Markdown / direct upload ingestion source
**Plan:** accept raw markdown via a new endpoint, convert to HTML through `marked`, feed the rest of the pipeline. Useful for writers who don't use Google Docs.
**Effort:** ~2 hours.

### D3. Sitemap-aware product link validation
**Today:** the `LinkValidationService` already catches broken URLs (hard 4xx, soft 404, redirect-to-home, unreachable) by probing every link at ingest time &mdash; that's the bulk of the value here.
**Plan (additive):** on first ingest for a new client, fetch + cache their sitemap. Add an `links.notInSitemap` rule that fires when a product link returned 200 but isn't in the sitemap (catches "page exists but is unlisted" cases &mdash; e.g. a draft product). Lighter weight than `links.hard4xx`; informational.
**Effort:** ~3 hours.

### D4. Table-of-contents extraction + injection
**Plan:** an extractor that builds a TOC from the heading outline. The publisher optionally injects it after the first paragraph in WordPress.
**Effort:** ~2 hours.

---

## E. Observability / ops

### E1. Per-rule firing analytics
**Plan:** a `rule_firings` table populated alongside each ingest. The Settings page gets a "rule effectiveness" tab: which rules fire most, what % of articles each rejects. Editors use this to tune thresholds with data.
**Effort:** ~4 hours.

### E2. Cost dashboard
**Plan:** aggregate `Article.totalCost` over time on the Articles list page. Add a "this week / month / all-time" cost rollup card. Catches AI-cost regressions before they bill.
**Effort:** ~2 hours.

### E3. Webhooks for ingestion + publish events
**Plan:** outbound HTTP POST to a configured URL on `article.ingested` and `article.published`. Lets editors wire Slack / Linear / their CMS without us building integrations directly.
**Effort:** ~3 hours.

### E4. Structured-logging sink (Logfire / Datadog / Sentry)
**Plan:** keep the file-based `decisions.log` for local dev; also ship the structured events to a real observability backend in production. Sourcerer-Be has the Logfire pattern, which can be ported.
**Effort:** ~4 hours.

---

## F. Frontend depth

### F1. Diff view (raw doc vs. cleaned WP HTML)
**Plan:** side-by-side diff on the article detail page showing what the sanitiser stripped. Helps editors understand what changed.
**Effort:** ~3 hours.

### F2. Inline "fix in doc" annotations
**Plan:** for each rule that fires, point at the offending paragraph in the body preview (highlight + jump-to-fix link). Editor sees exactly what to change.
**Effort:** ~5 hours.

### F3. Per-article cost-vs-decision scatter
**Plan:** simple Recharts plot on the Articles list page: x = ingest date, y = cost, colour = decision. Spots cost outliers and decision drift visually.
**Effort:** ~2 hours.

### F4. Editor accounts + audit trail
**Plan:** add NextAuth, persist `editorId` on every ingest + publish, surface "ingested by Jane on 2026-05-21" in the audit panel.
**Effort:** ~6 hours.

---

## G. Engineering rigor

### G1. Unit-test the rule layer
**Plan:** the deterministic scorer is a pure function &mdash; trivially testable. Build a table-test suite with hand-crafted `ExtractedArticle` fixtures for each rule. Aim for 100% rule coverage.
**Effort:** ~4 hours.

### G2. Snapshot-test the body-html sanitizer
**Plan:** capture the demo doc's raw HTML as a fixture, run `BodyHtmlService.extractWithUsage`, compare against a snapshot. Catches sanitiser regressions immediately.
**Effort:** ~1 hour.

### G3. Real Postgres in CI
**Plan:** GitHub Actions matrix runs the test suite against SQLite AND Postgres. Catches "works on sqlite, breaks on Postgres" regressions before they hit production.
**Effort:** ~2 hours.

### G4. Replace `synchronize: true` with TypeORM migrations
**Plan:** generate the initial migration, switch `synchronize` to false. Mirror Sourcerer-Be's migration workflow.
**Effort:** ~2 hours.

### G5. Throughput tests
**Plan:** ingest 100 articles in a loop, measure p50/p95/p99 latency + total cost. Establishes a baseline; alerts on regressions.
**Effort:** ~3 hours.

---

## Priorities if I had one more day

1. **A1** (Drive-image upload to WordPress) &mdash; closes the biggest "doesn't actually publish a real article" gap.
2. **C1** (image-relevance vision check &rarr; rule layer) &mdash; the stretch feature is already implemented, just needs to be wired into the gate.
3. **G1** (rule layer unit tests) &mdash; cheap insurance against future rule edits.
4. **F2** (inline "fix in doc" annotations) &mdash; turns the audit panel from "diagnostic" into "actionable" for editors.

## Priorities if I had one more week

Add to the above:

5. **B1 + B2** (per-client rule profiles + presets) &mdash; makes the system multi-tenant.
6. **E1** (per-rule firing analytics) &mdash; gives editors data to tune with.
7. **D3** (sitemap-aware product link validation) &mdash; catches the "linked a non-existent URL" mistake that's invisible today.
8. **G4** (proper migrations) &mdash; required before any production deploy.
