// Applies the carrier code map AND the economic class to a settlement's
// withheld deduction rows at save time (owner decisions 2026-11-03,
// docs/decisions/prime-code-classes.md). Replaces the old two-step
// "carrier-code category, then the owner's learned category" with one rule:
//
// - A code that is in the map WITH a class resolves from the map only — its
//   category, deductibility and class. Never the text classifier, never a
//   learned category (owner item 5: "a known code resolves from the map").
// - A code that is in the map with no class (ASK), or not in the map at all,
//   keeps today's behaviour for its CATEGORY (map category if any, then the
//   owner's learned category) and takes its CLASS from the owner's
//   remembered answer for this carrier + code; with no answer it is asked
//   once on the review card (`questions`).
//
// Every row also gets its DIRECTION as printed (R1).
import { findCarrierCodeMatch, type CarrierCode } from '@/src/import/carrierCodes';
import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';
import { applyLearnedCategories, normalizeKeyword, type LearningRule } from '@/src/import/categoryLearning';
import {
  asEconomicClass,
  classIsOutOfProfit,
  directionOfAmount,
  LEASE_PAYMENT_CATEGORY,
  resolveLineClass,
  type EconomicClass,
  type LineDirection,
  type LineQuestion,
  type ResolvedClass,
  type TruckOwnership,
} from '@/src/import/lineClass';

type Row = {
  description?: string | null;
  category?: string | null;
  tax_deductible?: boolean;
  code?: string | null;
  amount?: number | null;
};

export type ClassifiedRow<T> = T & { economic_class: ResolvedClass | null; direction: LineDirection };
export type LineClassQuestion = LineQuestion & { description: string | null };

export function learnedClassFor(row: Row, rules: LearningRule[], carrierKey: string | null): EconomicClass | null {
  if (!carrierKey) return null;
  const key = normalizeKeyword(row.code || row.description || '');
  if (!key) return null;
  const hit = rules.find((r) => r.carrier === carrierKey && r.economic_class && r.keyword === key);
  return asEconomicClass(hit?.economic_class);
}

export function classifySettlementLines<T extends Row>(
  rows: T[],
  carrierKey: string | null,
  codes: CarrierCode[],
  rules: LearningRule[],
  ownership: TruckOwnership | null
): { rows: ClassifiedRow<T>[]; questions: LineClassQuestion[] } {
  const questions: LineClassQuestion[] = [];
  const out = rows.map((row): ClassifiedRow<T> => {
    const direction = directionOfAmount(row.amount);
    const match = carrierKey && codes.length > 0 ? findCarrierCodeMatch(carrierKey, row.description, codes, row.code) : null;
    const mapClass = asEconomicClass(match?.economicClass);
    if (match && mapClass) {
      const r = resolveLineClass({ mapClass, classWhenCharge: asEconomicClass(match.classWhenCharge), direction, ownership, code: row.code ?? match.code });
      if (r.question) questions.push({ ...r.question, description: row.description ?? null });
      return {
        ...row,
        category: r.leaseNote ? LEASE_PAYMENT_CATEGORY : (match.category ?? row.category ?? null),
        ...(match.isDeductible != null ? { tax_deductible: match.isDeductible } : {}),
        economic_class: r.cls,
        direction,
      };
    }
    // ASK / unknown: today's category chain, class from the owner's answer.
    let next: T = row;
    if (match?.category) next = { ...next, category: match.category, ...(match.isDeductible != null ? { tax_deductible: match.isDeductible } : {}) };
    else next = applyLearnedCategories([next], rules, carrierKey)[0];
    // Carrier isolation: the unknown-line policy is for a carrier with a
    // seeded code map (Prime today); any other carrier keeps today's
    // behaviour with no class and no question.
    if (!carrierKey || !codes.some((c) => c.carrier === carrierKey)) return { ...next, economic_class: null, direction };
    const r = resolveLineClass({ mapClass: null, direction, ownership, learnedClass: learnedClassFor(row, rules, carrierKey), code: row.code ?? match?.code ?? null });
    if (r.question) questions.push({ ...r.question, description: row.description ?? null });
    return { ...next, category: r.leaseNote ? LEASE_PAYMENT_CATEGORY : next.category, economic_class: r.cls, direction };
  });
  return { rows: out, questions };
}

// The review card's one-time questions for an extracted settlement (before
// Save): the truck's ownership when a truck-payment code is printed and the
// truck has none, and each unclassed code once. Same rules as Save.
export type ReviewLineQuestion =
  | { kind: 'truck_ownership' }
  | { kind: 'unknown_code'; code: string | null; keyword: string; description: string | null; category: string | null };

export function previewLineQuestions(
  lines: { code?: string | null; desc?: string | null; amount?: number | null; category?: string | null }[],
  carrierKey: string | null,
  codes: CarrierCode[],
  rules: LearningRule[],
  ownership: TruckOwnership | null
): ReviewLineQuestion[] {
  const rows = lines.map((l) => ({ code: l.code ?? null, description: l.desc ?? null, amount: l.amount ?? null, category: l.category ?? null }));
  const { questions } = classifySettlementLines(rows, carrierKey, codes, rules, ownership);
  const out: ReviewLineQuestion[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    if (q.kind === 'truck_ownership') {
      if (!seen.has('#truck')) out.push({ kind: 'truck_ownership' });
      seen.add('#truck');
      continue;
    }
    const keyword = normalizeKeyword(q.code || q.description || '');
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    const line = rows.find((r) => normalizeKeyword(r.code || r.description || '') === keyword);
    out.push({ kind: 'unknown_code', code: q.code, keyword, description: q.description, category: line?.category ?? null });
  }
  return out;
}

// IMPORT GATE FIX 2.4 (owner 2026-11-03): Prime's reimbursement section can
// hold lines that are not reimbursements — PR "PERSONAL PAYMNT" (the owner's
// own money in) and WA "ADVANCE" (an advance taken) next to a real RF reefer
// reimbursement. Class from the code, direction from the document (these
// are credits): a line whose credit class is out of profit (repayment,
// personal, fund, capital, memo, interest income) is NOT a reimbursement
// and never offsets an expense — it is kept as a credit line with its
// class. A code with no class (or an expense code credited back, like RF)
// stays a reimbursement, as today. Carrier isolation: only a carrier with a
// seeded code map. Returns the indexes of `items` that are not
// reimbursements, with their class.
export type NonReimbursementCredit = { index: number; economicClass: ResolvedClass; category: string | null };

export function nonReimbursementCredits(
  items: { code?: string | null; desc?: string | null; amount?: number | string | null }[],
  carrierKey: string | null,
  codes: CarrierCode[]
): NonReimbursementCredit[] {
  if (!carrierKey) return [];
  const prime = isPrimeCarrier(carrierKey);
  const seeded = codes.some((c) => c.carrier === carrierKey);
  if (!prime && !seeded) return [];
  const out: NonReimbursementCredit[] = [];
  items.forEach((item, index) => {
    const code = (item.code ?? '').trim().toUpperCase() || null;
    // PR is Prime's code and is not in the code map. Owner decision
    // 2026-11-03 (on 5cb1df0): EVERY PR line is the owner's own money in
    // (Prime books it as PERSONAL PYMNT RCV), whatever its text — never an
    // expense offset. Keyed on Prime itself, so it holds even before the
    // code map has loaded.
    if (prime && code === 'PR') {
      out.push({ index, economicClass: 'PERSONAL', category: null });
      return;
    }
    if (!seeded) return;
    const match = findCarrierCodeMatch(carrierKey, item.desc ?? null, codes, code);
    const mapClass = asEconomicClass(match?.economicClass);
    if (!match || !mapClass) return;
    const r = resolveLineClass({ mapClass, classWhenCharge: asEconomicClass(match.classWhenCharge), direction: 'credit', ownership: null, code });
    if (r.cls && classIsOutOfProfit(r.cls)) out.push({ index, economicClass: r.cls, category: match.category ?? null });
  });
  return out;
}

// The answers the review card offers for an unclassed code (owner D11): the
// few classes a driver can tell from the line itself.
export const REVIEW_CLASS_CHOICES: ResolvedClass[] = ['EXPENSE_VARIABLE', 'PERSONAL', 'REPAYMENT', 'REFUNDABLE_FUND', 'REIMBURSEMENT'];
