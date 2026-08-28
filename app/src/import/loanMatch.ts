// LOAN MATCH — settlement-derived loans, dedupe by normalized identity
// (owner decision, device report: the extended warranty loan was
// re-created as a NEW Loan Center row on every settlement import instead
// of updating one existing row). Root cause, confirmed by reading
// app/src/data/aiImportSave.ts's loan-upsert loop before this fix: the
// match key was EXACT STRING EQUALITY on `loans.name`
// (`.eq('name', loan.name)`) — and the settlement schema's own loans[]
// section (supabase/functions/ai-import/index.ts) has no separate
// `lender`/original-amount field to fall back on, so `name` was the ONLY
// identifying value available. The AI's own extracted wording for a
// recurring loan-recap line naturally varies week to week (a trailing
// invoice/reference suffix, punctuation, capitalization) — the same class
// of "same vendor, slightly different text every time" problem
// `categoryLearning.ts`'s `normalizeKeyword()` already solves for
// deduction descriptions. This module applies the identical normalize-
// then-match approach to loan identity instead.
const LOAN_STOPWORDS = new Set(['the', 'a', 'an', 'inc', 'llc', 'co', 'corp', 'unit', 'no', 'number', 'ref', 'reference']);

// A longer token budget than categoryLearning.ts's default 3 — a real
// lender/loan name ("Navistar Financial Corp — Unit 830157", "Extended
// Warranty — CarShield") carries more meaningful words than a purchase
// description, and truncating too aggressively risks two DIFFERENT loans
// (e.g. two different lenders both containing "Financial") colliding.
const LOAN_KEY_MAX_TOKENS = 6;

export function normalizeLoanKey(text: string | null | undefined): string {
  const tokens = (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !LOAN_STOPWORDS.has(w) && !/^\d+$/.test(w));
  return tokens.slice(0, LOAN_KEY_MAX_TOKENS).join(' ').trim();
}

export type LoanMatchCandidate = {
  id: string;
  name: string | null;
  lender?: string | null;
  balance?: number | null;
  original_amount?: number | null;
};

export type IncomingLoan = {
  name?: string | null;
  lender?: string | null;
  balance?: number | null;
};

// A same-named-but-wildly-different-amount pair almost certainly isn't
// the same obligation (e.g. a $500/week recurring warranty repayment
// line happening to share a generic word with a $58,000 truck loan) —
// conservative on purpose: "never silently merge two amounts that don't
// plausibly refer to the same obligation." A genuine loan balance moves
// down gradually week to week and can occasionally jump (a lump-sum
// payoff, a refinance) but rarely swings by more than this ratio between
// two consecutive weekly recap lines for the SAME obligation.
const MAX_BALANCE_RATIO = 6;

// Finds the existing Loan Center row (if any) this settlement's own
// loans[] line most likely refers to. Checked in order: (1) the
// normalized name must match (exact, or one containing the other — the
// same substring-both-ways rule matchLearnedCategory() already uses);
// (2) if BOTH sides have a lender recorded, it must also agree — a
// shared generic name with two different lenders is not the same
// obligation; (3) if BOTH sides have a real balance, it must be within
// MAX_BALANCE_RATIO of the other — a name match alone is not trusted
// when the dollar amounts are implausibly far apart. Returns null (never
// a guess) when nothing plausible is found — the caller inserts a new
// row in that case, exactly like before this fix, just with a better
// chance of the name match actually firing on a real repeat import.
export function findMatchingLoan(incoming: IncomingLoan, candidates: LoanMatchCandidate[]): LoanMatchCandidate | null {
  const incomingKey = normalizeLoanKey(incoming.name);
  if (!incomingKey) return null;
  const incomingLenderKey = normalizeLoanKey(incoming.lender);

  for (const candidate of candidates) {
    const candidateKey = normalizeLoanKey(candidate.name);
    if (!candidateKey) continue;
    const nameMatches = candidateKey === incomingKey || candidateKey.includes(incomingKey) || incomingKey.includes(candidateKey);
    if (!nameMatches) continue;

    if (incomingLenderKey && candidate.lender) {
      const candidateLenderKey = normalizeLoanKey(candidate.lender);
      if (candidateLenderKey && candidateLenderKey !== incomingLenderKey) continue;
    }

    const existingAmount = Number(candidate.balance ?? candidate.original_amount ?? 0);
    const incomingAmount = Number(incoming.balance ?? 0);
    if (existingAmount > 0 && incomingAmount > 0) {
      const ratio = Math.max(existingAmount, incomingAmount) / Math.min(existingAmount, incomingAmount);
      if (ratio > MAX_BALANCE_RATIO) continue;
    }

    return candidate;
  }
  return null;
}

// DATA CLEANUP — group already-saved loans rows into likely-duplicate
// clusters (owner decision, device report: "give me a tool listing the
// duplicate warranty loans so I can merge/remove them"). Reuses the same
// normalizeLoanKey() every future import's own matching now uses, so a
// row this function groups as a duplicate is exactly what the fixed
// upsert would now treat as "the same loan" going forward. Deliberately
// does NOT compare balance/lender here (unlike findMatchingLoan, which
// is deciding whether to WRITE — a false-negative there just means an
// extra row gets created, cheap and reversible via this same cleanup
// tool; this function is presenting groups for a HUMAN to review before
// deleting anything, so it errs toward showing more candidates rather
// than hiding a real duplicate behind a balance-ratio guard).
export type LoanDuplicateGroup<T extends LoanMatchCandidate = LoanMatchCandidate> = {
  key: string;
  loans: T[];
};

export function findDuplicateLoanGroups<T extends LoanMatchCandidate>(loans: T[]): LoanDuplicateGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const loan of loans) {
    const key = normalizeLoanKey(loan.name);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(loan);
    else groups.set(key, [loan]);
  }
  return Array.from(groups.entries())
    .filter(([, group]) => group.length >= 2)
    .map(([key, group]) => ({ key, loans: group }));
}
