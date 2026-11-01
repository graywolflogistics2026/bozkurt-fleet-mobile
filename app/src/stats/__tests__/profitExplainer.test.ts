import { buildProfitExplanation, findPossibleDuplicates, weakestLabel, type OwnExpenseRow, type WithheldLine } from '@/src/stats/profitExplainer';
import { explanationSentence } from '@/src/stats/profitExplainerText';
import type { LedgerRow } from '@/src/stats/auditLedger';
import en from '@/src/i18n/locales/en.json';
import tr from '@/src/i18n/locales/tr.json';

// PROFIT EXPLAINER (owner decision 2026-10-30, batch D item 8) — the pure
// rules. The golden-week numbers (2,534.36 − 150.00 = 2,384.36 on every
// period and per truck) live in goldenPrimeSettlement.test.ts.

function translator(locale: Record<string, unknown>) {
  const get = (key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], locale);
  return (key: string, o: Record<string, unknown> = {}) => {
    const plural = typeof o.count === 'number' ? get(`${key}_${o.count === 1 ? 'one' : 'other'}`) : undefined;
    const raw = (plural ?? get(key) ?? key) as string;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(o[k]));
  };
}
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ledgerRow = (over: Partial<LedgerRow>): LedgerRow => ({
  key: 'k',
  table: 'deductions',
  rowId: 'r',
  source: 'manual',
  settlementId: null,
  deductionId: 'r',
  date: '2026-08-18',
  label: 'x',
  category: 'Supplies',
  status: 'counted',
  amount: 0,
  reason: 'expense',
  ...over,
});

describe('buildProfitExplanation', () => {
  const ownLedger = [ledgerRow({ key: 'a', rowId: 'a', amount: 100 }), ledgerRow({ key: 'b', rowId: 'b', amount: 50 })];
  const base = { labels: ['verified_prime' as const], mismatchWeeks: 0, withheld: [], keptKeys: new Set<string>() };

  it('the owner sentence, word for word (EN and TR)', () => {
    const e = buildProfitExplanation({ ...base, settlementsProfit: 2534.36, ledger: ownLedger, profit: 2384.36 });
    expect(explanationSentence(e, translator(en), money, 'thisWeek')).toBe(
      'Your settlements show $2,534.36 profit. You added $150.00 of your own expenses (2 items) this week, so your profit is $2,384.36.'
    );
    expect(explanationSentence(e, translator(tr), money, 'thisWeek')).toBe(
      "Settlement'larına göre kârın $2,534.36. Bu hafta kendi eklediğin $150.00 gider var (2 kalem), o yüzden kârın $2,384.36."
    );
  });

  it('a difference A − B − C ≠ 0 is never hidden: "Unexplained difference", warning tone', () => {
    const e = buildProfitExplanation({ ...base, settlementsProfit: 2534.36, ledger: ownLedger, profit: 2380 });
    expect([e.case, e.tone, e.residual]).toEqual(['unexplained', 'warning', 4.36]);
    expect(explanationSentence(e, translator(en), money, 'period')).toBe('Unexplained difference $4.36 — this needs a look.');
  });

  it('own expenses are information; only a printed-statement mismatch is amber', () => {
    expect(buildProfitExplanation({ ...base, settlementsProfit: 2534.36, ledger: ownLedger, profit: 2384.36 }).tone).toBe('info');
    const m = buildProfitExplanation({ ...base, mismatchWeeks: 1, settlementsProfit: 2534.36, ledger: ownLedger, profit: 2384.36 });
    expect([m.case, m.tone]).toEqual(['extractionMismatch', 'warning']);
  });

  it('settlement-linked and Prime-statement rows are never "own"; excluded own rows are listed, not counted', () => {
    const e = buildProfitExplanation({
      ...base,
      settlementsProfit: 1000,
      ledger: [
        ledgerRow({ key: 'w', settlementId: 's1', source: 'settlement', amount: 80 }),
        ledgerRow({ key: 'p', table: 'statement', source: 'prime_statement', settlementId: 's1', amount: 500 }),
        ledgerRow({ key: 'm', rowId: 'm', status: 'excluded', reason: 'meals_per_diem', category: 'Meals (per diem covered)', amount: 24.5 }),
        ledgerRow({ key: 'r', table: 'reimbursements', rowId: 'r', status: 'offset', reason: 'reimbursement', amount: 30 }),
      ],
      profit: 1030,
    });
    expect(e.ownExpenses).toMatchObject({ total: -30, count: 1 });
    expect(e.notCounted.map((r) => r.reason)).toEqual(['meals_per_diem']);
    expect(e.residual).toBe(0);
  });

  it('weakest label wins; none without settlements', () => {
    expect(weakestLabel([])).toBeNull();
    expect(weakestLabel(['verified_prime', 'totals_match'])).toBe('totals_match');
    expect(weakestLabel(['verified_prime', 'unverified', 'totals_match'])).toBe('unverified');
  });
});

describe('findPossibleDuplicates', () => {
  const own = (over: Partial<OwnExpenseRow> = {}): OwnExpenseRow => ({ key: 'o', table: 'deductions', rowId: 'o', date: '2026-08-18', label: 'pump', category: 'Fuel & DEF', amount: 341.04, ...over });
  const line: WithheldLine = { table: 'deductions', id: 'w', date: '2026-08-15', amount: 341.04, category: 'Fuel & DEF', label: 'TRACTOR FUEL', settlementId: 's' };

  it('same amount, within 3 days, similar category -> flagged', () => {
    expect(findPossibleDuplicates([own()], [line], new Set())).toHaveLength(1);
    expect(findPossibleDuplicates([own({ table: 'fuel_purchases', category: null })], [line], new Set())).toHaveLength(1);
  });

  it('4 days apart, a different amount, or another category -> not flagged', () => {
    expect(findPossibleDuplicates([own({ date: '2026-08-19' })], [line], new Set())).toEqual([]);
    expect(findPossibleDuplicates([own({ amount: 341.5 })], [line], new Set())).toEqual([]);
    expect(findPossibleDuplicates([own({ category: 'Supplies' })], [line], new Set())).toEqual([]);
  });

  it('"keep" silences it; offsets and statement rows are never candidates', () => {
    expect(findPossibleDuplicates([own()], [line], new Set(['deductions:o']))).toEqual([]);
    expect(findPossibleDuplicates([own({ amount: -341.04 })], [line], new Set())).toEqual([]);
  });
});
