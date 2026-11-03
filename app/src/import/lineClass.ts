// ECONOMIC CLASS OF A SETTLEMENT LINE (owner decisions 2026-11-03, R1-R4,
// D1-D11; docs/decisions/prime-code-classes.md, PENDING_SQL §84).
//
// R1: the CLASS comes from the carrier's code map (never from the text
// classifier); the DIRECTION comes from the document (charge = money out,
// credit = money in). Pure — no Supabase, no React — so every rule here is
// unit tested (src/import/__tests__/lineClass.test.ts).
//
// Carrier isolation is unchanged: a class is only ever read from a code-map
// row that findCarrierCodeMatch() matched for THIS statement's own carrier.

export const ECONOMIC_CLASSES = [
  'REVENUE',
  'REIMBURSEMENT',
  'EXPENSE_VARIABLE',
  'EXPENSE_FIXED',
  'WAGES',
  'INTEREST_EXPENSE',
  'INTEREST_INCOME',
  'REPAYMENT',
  'REFUNDABLE_FUND',
  'PERSONAL',
  'CAPITAL',
  'INFORMATIONAL',
  // Families the runtime resolves (never stored on a saved line):
  // TRUCK_PAYMENT by the truck's ownership, INTEREST by direction.
  'TRUCK_PAYMENT',
  'INTEREST',
] as const;
export type EconomicClass = (typeof ECONOMIC_CLASSES)[number];
export type ResolvedClass = Exclude<EconomicClass, 'TRUCK_PAYMENT' | 'INTEREST'>;
export type LineDirection = 'charge' | 'credit';
export type TruckOwnership = 'owned_cash' | 'financed' | 'leased';

export function asEconomicClass(v: unknown): EconomicClass | null {
  return typeof v === 'string' && (ECONOMIC_CLASSES as readonly string[]).includes(v) ? (v as EconomicClass) : null;
}

export function asTruckOwnership(v: unknown): TruckOwnership | null {
  return v === 'owned_cash' || v === 'financed' || v === 'leased' ? v : null;
}

// Direction as printed: a settlement deduction line is a charge; a line the
// statement prints as a credit reaches us with a negative amount.
export function directionOfAmount(amount: number | null | undefined): LineDirection {
  return typeof amount === 'number' && amount < 0 ? 'credit' : 'charge';
}

export type LineQuestion = { kind: 'truck_ownership' } | { kind: 'unknown_code'; code: string | null };

export type LineClassInput = {
  // The matched code-map row's class (null = not in the map, or ASK).
  mapClass: EconomicClass | null;
  // The class this code takes when printed as a CHARGE (PC only).
  classWhenCharge?: EconomicClass | null;
  direction: LineDirection;
  ownership: TruckOwnership | null;
  // The owner's own remembered answer for this carrier + code.
  learnedClass?: EconomicClass | null;
  code?: string | null;
};

export type LineClassResult = { cls: ResolvedClass | null; question: LineQuestion | null; leaseNote: boolean; taxProNote: boolean };

function resolveFamily(cls: EconomicClass, direction: LineDirection, ownership: TruckOwnership | null): { cls: ResolvedClass | null; question: LineQuestion | null; leaseNote: boolean } {
  if (cls === 'INTEREST') return { cls: direction === 'credit' ? 'INTEREST_INCOME' : 'INTEREST_EXPENSE', question: null, leaseNote: false };
  if (cls === 'TRUCK_PAYMENT') {
    // D10: decided by ownership, not by the code. owned_cash (a truck paid
    // for) printing a truck payment is not expected: asked like null.
    if (ownership === 'leased') return { cls: 'EXPENSE_FIXED', question: null, leaseNote: true };
    if (ownership === 'financed') return { cls: 'REPAYMENT', question: null, leaseNote: false };
    return { cls: null, question: { kind: 'truck_ownership' }, leaseNote: false };
  }
  return { cls, question: null, leaseNote: false };
}

export function resolveLineClass(input: LineClassInput): LineClassResult {
  const { direction, ownership } = input;
  let base: EconomicClass | null = input.mapClass;
  if (base && direction === 'charge' && input.classWhenCharge) base = input.classWhenCharge;
  if (!base) {
    // Not in the map / ASK: the owner's remembered answer, else ask once.
    if (input.learnedClass) {
      const r = resolveFamily(input.learnedClass, direction, ownership);
      return { ...r, taxProNote: false };
    }
    return { cls: null, question: { kind: 'unknown_code', code: input.code ?? null }, leaseNote: false, taxProNote: false };
  }
  const r = resolveFamily(base, direction, ownership);
  // FN (credit of the truck-payment family) and the TS family credit (IB)
  // are flagged for the tax professional (D8, D10).
  const taxProNote = direction === 'credit' && (input.mapClass === 'TRUCK_PAYMENT' || (input.mapClass === 'REPAYMENT' && r.cls === 'REPAYMENT'));
  return { ...r, taxProNote };
}

// Classes that never change profit: money that is not earned or spent by
// the business (R1, R3, R4, D2, D3). A line with no class (null) keeps
// today's category behaviour.
export const OUT_OF_PROFIT_CLASSES: ReadonlySet<string> = new Set<ResolvedClass>([
  'REPAYMENT',
  'REFUNDABLE_FUND',
  'PERSONAL',
  'CAPITAL',
  'INFORMATIONAL',
  'INTEREST_INCOME',
]);

export function classIsOutOfProfit(cls: string | null | undefined): boolean {
  return !!cls && OUT_OF_PROFIT_CLASSES.has(cls);
}

// D10: a leased truck's payment is booked as rent.
export const LEASE_PAYMENT_CATEGORY = 'Lease & Rent';
