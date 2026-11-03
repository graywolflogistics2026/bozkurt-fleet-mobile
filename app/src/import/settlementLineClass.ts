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
import { applyLearnedCategories, normalizeKeyword, type LearningRule } from '@/src/import/categoryLearning';
import {
  asEconomicClass,
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
