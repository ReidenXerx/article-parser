/**
 * Server-side API helper.
 *
 * In Next.js server components we can't use the rewrite proxy (no
 * relative URL context), so this resolves the backend URL from env at
 * call time and fetches directly. Client components keep using `/api/*`
 * which the rewrite forwards.
 */

const BACKEND =
  process.env.BACKEND_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:3001';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`API ${path} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface ArticleSummary {
  id: string;
  sourceUrl: string;
  docId: string;
  articleTitle: string;
  finalDecision: 'accept' | 'reject' | 'escalate';
  score: number;
  totalCost: number;
  publishedTo: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface RuleHit {
  name: string;
  weight: number;
  matched: string;
}

export interface ArticleDetail {
  id: string;
  sourceUrl: string;
  docId: string;
  ingestMode: string;
  meta: {
    articleTitle: string;
    metaTitle: string | null;
    metaDescription: string | null;
    source: {
      articleTitle: 'h1' | 'ai-fallback' | 'missing';
      metaTitle: 'regex' | 'ai-fallback' | 'missing';
      metaDescription: 'regex' | 'ai-fallback' | 'missing';
    };
  };
  bodyClean: string;
  bodyRaw: string;
  images: Array<{
    rawUrl: string;
    altText: string;
    kind: 'embedded' | 'placeholder-link';
    drive?: {
      fileId: string | null;
      directViewUrl: string | null;
      permission: 'public' | 'private' | 'not-drive' | 'unknown';
      status?: number;
    };
  }>;
  links: Array<{
    href: string;
    anchorText: string;
    classification:
      | 'product'
      | 'brand'
      | 'internal'
      | 'external'
      | 'image-placeholder';
    validation?: {
      status:
        | 'ok'
        | 'hard-4xx'
        | 'hard-5xx'
        | 'soft-404'
        | 'redirect'
        | 'unreachable'
        | 'skipped';
      httpStatus?: number;
      finalUrl?: string;
      detail: string;
    };
  }>;
  formatting: {
    h1Count: number;
    headingOutline: Array<{ level: number; text: string }>;
    paragraphCount: number;
    maxParagraphChars: number;
    wordCount: number;
    imagesMissingAlt: number;
  };
  qualityReport: {
    finalDecision: 'accept' | 'reject' | 'escalate';
    deterministic: {
      decision: 'accept' | 'reject' | 'escalate';
      score: number;
      rules: RuleHit[];
    };
    ai?: {
      verdict: 'accept' | 'reject';
      reasoning: string;
    };
  };
  totalCost: number;
  publishedTo: string | null;
  publishedId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  acceptThreshold: number;
  rejectThreshold: number;
  minImages: number;
  maxImages: number;
  minProductLinks: number;
  maxProductLinks: number;
  ruleWeights: Record<string, number>;
}
