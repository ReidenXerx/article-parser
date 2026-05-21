/**
 * Typed decision categories for the article-parser quality pipeline.
 *
 * Every `logger.decide(category, observed, outcome, detail?)` call MUST use
 * one of these values. Mirrors Sourcerer-Be's pattern: promoting free-form
 * strings to a typed union lets us:
 *
 *   - filter decision logs reliably ("show me all DRIVE-PERM failures")
 *   - catch typos at compile time
 *   - keep per-article `*.decisions.log` files canonically formatted regardless
 *     of who writes the decide() call
 *
 * Add a new category here BEFORE using it. TypeScript will refuse strings
 * not in this union, which is the point.
 */
export type DecisionCategory =
  // Ingestion
  | 'INGEST'
  | 'DOC-FETCH'
  | 'DOC-FORMAT'
  | 'DOC-NORMALIZE'

  // Extractors
  | 'META-FIELDS'
  | 'BODY-HTML'
  | 'IMAGE-SCAN'
  | 'LINK-SCAN'
  | 'FORMAT-AUDIT'

  // Drive checks
  | 'DRIVE-PARSE'
  | 'DRIVE-PERM'

  // Link reachability
  | 'LINK-VALIDATE'

  // Quality gate
  | 'QUALITY-RULE'
  | 'QUALITY-VERDICT'
  | 'QUALITY-AI'
  | 'QUALITY-SUMMARY'

  // Stretch features
  | 'IMAGE-RELEVANCE'

  // Publishing
  | 'PUBLISH';

export type ArticleParserScopeKind = 'ingest';

export type ArticleParserScope = {
  kind: 'ingest';
  /** Article id once persisted, or '(unsaved)' before the row exists. */
  articleId: string;
  /** Source doc URL — what the editor pasted in. */
  sourceUrl: string;
};
