// CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
// follow-up item G) — every time a user manually re-categorizes a
// deduction, a normalized keyword→category rule is stored (per user,
// `category_learning_rules` table, docs/PENDING_SQL.md §47). On the NEXT
// import, these rules are checked BEFORE the built-in regex-based
// guesser (`app/src/import/category.ts`'s `guessCategory()`) — a rule
// the user has explicitly taught wins over any heuristic. This is
// PROMPT-CONTEXT ONLY: the rules are sent to `ai-import` as plain text
// hints appended to the extraction prompt (a "USER CORRECTIONS" section)
// and applied client-side as a post-processing override — the underlying
// Claude model is never fine-tuned or retrained on any user's data. State
// this plainly in the viewer UI (`app/(tabs)/more/category-learning.tsx`).
//
// A rule's `keyword` is the first few significant, non-numeric words of
// the description the user corrected FROM — e.g. "AMAZON.COM ORDER
// #123-4567" -> "amazon com order" — deliberately dropping the numeric
// order-id suffix so the SAME vendor across many receipts still matches
// even though the trailing digits differ every time.
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'inc',
  'llc',
  'co',
  'corp',
  'purchase',
  'payment',
  'fee',
  'charge',
  'store',
  'company',
]);

const DEFAULT_MAX_KEYWORD_TOKENS = 3;

export function normalizeKeyword(text: string | null | undefined, maxTokens = DEFAULT_MAX_KEYWORD_TOKENS): string {
  const tokens = (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return tokens.slice(0, maxTokens).join(' ').trim();
}

export type LearningRule = { keyword: string; category: string };

// Classic edit-distance — used only as a typo/OCR-tolerance fallback
// AFTER an exact/substring match has already failed (the common case, a
// clean repeat of the same vendor name, never needs this).
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

// Checks a description against every learned rule, FUZZY (spec item G):
// (1) exact/substring match first — the fast, common path; (2)
// word-level Levenshtein distance within 25% of the longer string's
// length as a typo/OCR-tolerant fallback, picking the closest match.
// Returns null (never a guess) when nothing is close enough.
export function matchLearnedCategory(description: string | null | undefined, rules: LearningRule[]): string | null {
  if (!description || rules.length === 0) return null;
  const normalized = normalizeKeyword(description);
  if (!normalized) return null;

  for (const rule of rules) {
    if (!rule.keyword) continue;
    if (normalized === rule.keyword || normalized.includes(rule.keyword) || rule.keyword.includes(normalized)) {
      return rule.category;
    }
  }

  let best: { category: string; distance: number } | null = null;
  for (const rule of rules) {
    if (!rule.keyword) continue;
    const distance = levenshtein(normalized, rule.keyword);
    const threshold = Math.max(1, Math.floor(Math.max(normalized.length, rule.keyword.length) * 0.25));
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { category: rule.category, distance };
    }
  }
  return best?.category ?? null;
}

// Applied to a batch of mapped deduction inserts right before they're
// saved (app/src/data/aiImportSave.ts) — a learned rule wins over
// whatever category the AI/built-in guesser already assigned, since it
// represents the user's own explicit, repeated correction.
export function applyLearnedCategories<T extends { description?: string | null; category?: string | null }>(
  rows: T[],
  rules: LearningRule[]
): T[] {
  if (rules.length === 0) return rows;
  return rows.map((row) => {
    const learned = matchLearnedCategory(row.description ?? null, rules);
    return learned ? { ...row, category: learned } : row;
  });
}

// Builds the compact "USER CORRECTIONS" text block appended to the
// ai-import extraction prompt (supabase/functions/ai-import/index.ts) —
// plain prompt-context hints, never a training signal. Capped at 30
// rules to keep the prompt bounded even for a long-time user with many
// learned corrections.
const MAX_PROMPT_RULES = 30;

export function buildUserCorrectionsPromptText(rules: LearningRule[]): string {
  if (rules.length === 0) return '';
  const lines = rules
    .slice(0, MAX_PROMPT_RULES)
    .map((r) => `- "${r.keyword}" -> ${r.category}`)
    .join('\n');
  return `USER CORRECTIONS (this user has manually corrected these before — prefer these categories when the description matches):\n${lines}`;
}
