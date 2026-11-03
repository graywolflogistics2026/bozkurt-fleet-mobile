// PRIME CODE CLASSES runtime (owner decisions 2026-11-03, R1-R4, D1-D11;
// docs/decisions/prime-code-classes.md, PENDING_SQL §84).
import { resolveLineClass, directionOfAmount, classIsOutOfProfit } from '@/src/import/lineClass';
import { classifySettlementLines, previewLineQuestions } from '@/src/import/settlementLineClass';
import type { CarrierCode } from '@/src/import/carrierCodes';
import type { LearningRule } from '@/src/import/categoryLearning';
import { reducesTrueProfit, sumCanonicalExpenses } from '@/src/stats/trueProfit';
import { buildLineItems, buildPersonalSettlementItems } from '@/src/stats/accountantPackage';
import type { Deduction } from '@/src/types/db';

function code(c: string, cls: string | null, extra: Partial<CarrierCode> = {}): CarrierCode {
  return {
    carrier: 'PRIME INC',
    code: c,
    subCode: null,
    label: c,
    description: null,
    category: 'Misc',
    isDeductible: true,
    incomeOrChargeback: 'chargeback',
    notes: null,
    economicClass: cls,
    classWhenCharge: null,
    ...extra,
  };
}

const CODES: CarrierCode[] = [
  code('NP', 'TRUCK_PAYMENT', { category: 'Truck/Trailer Payments' }),
  code('NT', 'REFUNDABLE_FUND', { category: 'Escrow & Deposits' }),
  code('H1', 'PERSONAL', { category: 'Insurance' }),
  code('UD', 'REIMBURSEMENT', { category: 'Fuel & DEF' }),
  code('PC', 'REIMBURSEMENT', { classWhenCharge: 'PERSONAL' }),
  code('IH', 'INTEREST'),
  code('CY', null),
];

const line = (c: string, amount: number) => ({ code: c, description: c + ' line', amount, category: 'Misc', tax_deductible: true });

describe('resolveLineClass', () => {
  it('direction comes from the printed sign', () => {
    expect(directionOfAmount(50)).toBe('charge');
    expect(directionOfAmount(-50)).toBe('credit');
    expect(directionOfAmount(null)).toBe('charge');
  });

  it('IH resolves by direction', () => {
    expect(resolveLineClass({ mapClass: 'INTEREST', direction: 'credit', ownership: null }).cls).toBe('INTEREST_INCOME');
    expect(resolveLineClass({ mapClass: 'INTEREST', direction: 'charge', ownership: null }).cls).toBe('INTEREST_EXPENSE');
  });

  it('NP: leased and financed give different classes; unknown asks once', () => {
    const leased = resolveLineClass({ mapClass: 'TRUCK_PAYMENT', direction: 'charge', ownership: 'leased' });
    const financed = resolveLineClass({ mapClass: 'TRUCK_PAYMENT', direction: 'charge', ownership: 'financed' });
    const unknown = resolveLineClass({ mapClass: 'TRUCK_PAYMENT', direction: 'charge', ownership: null });
    expect(leased).toMatchObject({ cls: 'EXPENSE_FIXED', leaseNote: true });
    expect(financed).toMatchObject({ cls: 'REPAYMENT', leaseNote: false });
    expect(unknown).toMatchObject({ cls: null, question: { kind: 'truck_ownership' } });
  });

  it('PC as a charge is PERSONAL, as a credit a reimbursement', () => {
    expect(resolveLineClass({ mapClass: 'REIMBURSEMENT', classWhenCharge: 'PERSONAL', direction: 'charge', ownership: null }).cls).toBe('PERSONAL');
    expect(resolveLineClass({ mapClass: 'REIMBURSEMENT', classWhenCharge: 'PERSONAL', direction: 'credit', ownership: null }).cls).toBe('REIMBURSEMENT');
  });

  it('an ASK/unknown code asks, unless the owner already answered', () => {
    expect(resolveLineClass({ mapClass: null, direction: 'charge', ownership: null, code: 'CY' })).toMatchObject({ cls: null, question: { kind: 'unknown_code', code: 'CY' } });
    expect(resolveLineClass({ mapClass: null, direction: 'charge', ownership: null, learnedClass: 'EXPENSE_VARIABLE' })).toMatchObject({ cls: 'EXPENSE_VARIABLE', question: null });
  });
});

describe('classifySettlementLines', () => {
  it('a known code resolves from the map only (class, category, direction)', () => {
    const { rows, questions } = classifySettlementLines([line('NT', -40)], 'PRIME INC', CODES, [], null);
    expect(rows[0]).toMatchObject({ economic_class: 'REFUNDABLE_FUND', direction: 'credit', category: 'Escrow & Deposits' });
    expect(questions).toEqual([]);
  });

  it('a leased truck books NP as Lease & Rent', () => {
    const { rows } = classifySettlementLines([line('NP', 900)], 'PRIME INC', CODES, [], 'leased');
    expect(rows[0]).toMatchObject({ economic_class: 'EXPENSE_FIXED', category: 'Lease & Rent' });
  });

  it('an ASK code asks once; a remembered answer for this carrier is used', () => {
    const asked = classifySettlementLines([line('CY', 10)], 'PRIME INC', CODES, [], null);
    expect(asked.rows[0].economic_class).toBeNull();
    expect(asked.questions).toHaveLength(1);
    const rules: LearningRule[] = [{ keyword: 'cy', category: 'Misc', carrier: 'PRIME INC', economic_class: 'EXPENSE_VARIABLE' }];
    const answered = classifySettlementLines([line('CY', 10)], 'PRIME INC', CODES, rules, null);
    expect(answered.rows[0].economic_class).toBe('EXPENSE_VARIABLE');
    expect(answered.questions).toEqual([]);
  });

  it('Prime codes never apply to another carrier (no class, no question)', () => {
    const { rows, questions } = classifySettlementLines([line('NP', 900), line('H1', 50)], 'OTHER CARRIER', CODES, [], 'leased');
    expect(rows.map((r) => r.economic_class)).toEqual([null, null]);
    expect(rows[0].category).toBe('Misc');
    expect(questions).toEqual([]);
  });
});

describe('profit effect of a class', () => {
  const ded = (amount: number, economic_class: string | null, category = 'Misc') => ({
    amount,
    economic_class,
    source: 'settlement',
    category,
    tax_deductible: true,
    settlement_id: null,
  });

  it('a fund credit never changes profit and never becomes revenue', () => {
    expect(classIsOutOfProfit('REFUNDABLE_FUND')).toBe(true);
    expect(reducesTrueProfit(ded(-40, 'REFUNDABLE_FUND'))).toBe(false);
    // Expenses unchanged by the fund credit (it is not netted against costs, not income).
    expect(sumCanonicalExpenses([ded(100, 'EXPENSE_VARIABLE'), ded(-40, 'REFUNDABLE_FUND')], [], [], [], [])).toBe(100);
  });

  it('leased vs financed NP give different profit', () => {
    const leased = classifySettlementLines([line('NP', 900)], 'PRIME INC', CODES, [], 'leased').rows;
    const financed = classifySettlementLines([line('NP', 900)], 'PRIME INC', CODES, [], 'financed').rows;
    const asDed = (r: (typeof leased)[number]) => ({ ...r, source: 'settlement', settlement_id: null });
    expect(sumCanonicalExpenses(leased.map(asDed), [], [], [], [])).toBe(900);
    expect(sumCanonicalExpenses(financed.map(asDed), [], [], [], [])).toBe(0);
  });

  it('a fuel discount (UD credit) offsets fuel, never revenue', () => {
    const { rows } = classifySettlementLines([line('UD', -50)], 'PRIME INC', CODES, [], null);
    expect(rows[0]).toMatchObject({ economic_class: 'REIMBURSEMENT', direction: 'credit' });
    const expenses = sumCanonicalExpenses(
      rows.map((r) => ({ ...r, source: 'settlement', settlement_id: null })),
      [{ amount: 500, settlement_id: null }],
      [],
      [],
      []
    );
    expect(expenses).toBe(450);
  });
});

describe('Accountant Package: PERSONAL withheld lines (R4)', () => {
  const base = { user_id: 'u', truck_id: null, settlement_id: 's1', source: 'settlement', ded_date: '2026-10-10', tax_deductible: true } as unknown as Deduction;
  const health = { ...base, id: 'h', amount: 120, category: 'Insurance', description: 'Health insurance', economic_class: 'PERSONAL' } as Deduction;
  const truckIns = { ...base, id: 't', amount: 300, category: 'Insurance', description: 'Physical damage', economic_class: 'EXPENSE_FIXED' } as Deduction;

  it('lands in its own section, not in business expenses', () => {
    const items = buildLineItems([health, truckIns], [], [], [], 2026, null, 'combined');
    expect(items.map((i) => i.id)).toEqual(['t']);
    const personal = buildPersonalSettlementItems([health, truckIns], 2026, null);
    expect(personal.items.map((i) => i.id)).toEqual(['h']);
    expect(personal.total).toBe(120);
  });

  it('other out-of-profit classes are not deductible', () => {
    const repay = { ...base, id: 'r', amount: 500, category: 'Truck/Trailer Payments', economic_class: 'REPAYMENT' } as Deduction;
    const [item] = buildLineItems([repay], [], [], [], 2026, null, 'combined');
    expect(item.deductible).toBe(false);
  });
});

describe('review card questions (asked once)', () => {
  const lines = [
    { code: 'NP', desc: 'truck payment', amount: 900 },
    { code: 'NP', desc: 'truck payment', amount: 900 },
    { code: 'CY', desc: 'cy line', amount: 10 },
    { code: 'CY', desc: 'cy line', amount: 12 },
  ];
  it('one ownership question and one question per unclassed code', () => {
    const qs = previewLineQuestions(lines, 'PRIME INC', CODES, [], null);
    expect(qs.map((q) => q.kind)).toEqual(['truck_ownership', 'unknown_code']);
  });
  it('nothing is asked once answered, and never for another carrier', () => {
    const rules: LearningRule[] = [{ keyword: 'cy', category: 'Misc', carrier: 'PRIME INC', economic_class: 'PERSONAL' }];
    expect(previewLineQuestions(lines, 'PRIME INC', CODES, rules, 'financed')).toEqual([]);
    expect(previewLineQuestions(lines, 'OTHER CARRIER', CODES, [], null)).toEqual([]);
  });
});
