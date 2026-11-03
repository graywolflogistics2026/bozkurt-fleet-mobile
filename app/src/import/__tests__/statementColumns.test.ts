// R2 — STATEMENT COLUMNS {label, weeks, ytd, ltd} (owner decision
// 2026-11-03, device finding: figures slipped from WEEKS TOTAL into the
// YTD/LTD columns). The app counts the WEEKS column only; a null WEEKS is
// not counted; the weekTotal* / payout scalars come only from labeled rows.
import { normalizeStatementColumns } from '../../../../supabase/functions/ai-import/chunking';
import { golden0814 } from '@/src/data/__tests__/golden0814Fixture';
import { buildPrimeStatementCheck } from '@/src/import/settlementStatement';
import { latestYtdContinuity, statementYtdRows, ytdContinuity } from '@/src/import/ytdContinuity';
import type { Extraction } from '@/src/import/types';

type Op = NonNullable<NonNullable<Extraction['settlement']>['operating']> & Record<string, unknown>;

// Prime's printed TOTAL labels for the fixture's older single-number fields.
const TOTAL_LABEL_OF: Record<string, string> = {
  weekTotalFreightRevenue: 'TOTAL FREIGHT REVENUE',
  weekTotalOtherRevenue: 'TOTAL OTHER REVENUE',
  weekTotalRevenue: 'TOTAL REVENUE',
  weekTotalFuelOilTax: 'TOTAL FUEL,OIL,TAX',
  weekTotalRepair: 'TOTAL EQUIPMENT REPAIR AND MAINT.',
  weekTotalTires: 'TOTAL TIRES',
  weekTotalMiscellaneous: 'TOTAL MISCELLANEOUS',
  weekTotalVariableCosts: 'TOTAL VARIABLE COSTS',
  weekTotalOutOfPocket: 'TOTAL OUT OF POCKET COSTS',
  weekTotalFixedCost: 'TOTAL FIXED COST',
  weekTotalOtherIncomeAndExpense: 'TOTAL OTHER INCOME AND EXPENSE',
  weekTotalOperatingExpenses: 'TOTAL OPERATING EXPENSES',
  weekTotalStatement: 'TOTAL STATEMENT OF INCOME & EXPENSE',
  weekTotalCashFlow: 'TOTAL CASH FLOW',
};

// The golden 08/14 week as the new model reply: columns, labeled recap rows,
// no single-number fields (stale scalars a model might still fill are set
// to wrong values on purpose — they must never count).
function asColumnReply(e: Extraction): Extraction {
  const op = e.settlement!.operating as Op;
  const recapLines: { label: string; weeks: string | number | null; ytd: string | number | null; ltd: null }[] = [];
  if (op.weekMiles) recapLines.push({ label: 'MILES', weeks: op.weekMiles as number, ytd: '41,250.00', ltd: null });
  if (op.priorWeekBalanceForward) recapLines.push({ label: 'PRIOR WEEK BALANCE FORWARD', weeks: op.priorWeekBalanceForward as number, ytd: null, ltd: null });
  if (op.settlementToOperator) recapLines.push({ label: (op.settlementToOperatorLabel as string) || 'SETTLEMENT TO OPERATOR', weeks: op.settlementToOperator as number, ytd: null, ltd: null });
  if (op.directDeposit) recapLines.push({ label: (op.directDepositLabel as string) || 'DIRECT DEPOSIT TO BANK', weeks: op.directDeposit as number, ytd: null, ltd: null });
  const reply: Op = {
    lines: [
      ...(op.lines ?? []).map((l) => ({ section: l.section, label: l.label, weeks: l.amount as number, ytd: '9,999.99', ltd: '99,999.99' })),
      // A YTD-only row (blank this week) is not counted.
      { section: 'misc', label: 'WIRE CHARGE', weeks: null, ytd: '15.00', ltd: '45.00' },
    ],
    totalLines: Object.entries(TOTAL_LABEL_OF)
      .filter(([field]) => typeof op[field] === 'number' && op[field] !== 0)
      .map(([field, label]) => ({ label, weeks: op[field] as number, ytd: field === 'weekTotalRevenue' ? '19,642.23' : null, ltd: null })),
    recapLines,
    weekTotalStatement: 123456, // stale scalar: must be ignored
    settlementToOperator: 1, // stale scalar: must be ignored
    weeksInService: op.weeksInService,
  } as unknown as Op;
  return { ...e, settlement: { ...e.settlement!, operating: reply } } as Extraction;
}

describe('R2: statement columns', () => {
  test('the golden 08/14 week read as columns passes the same gate with the same totals', () => {
    const before = buildPrimeStatementCheck(golden0814())!;
    const after = buildPrimeStatementCheck(normalizeStatementColumns(asColumnReply(golden0814())) as Extraction)!;
    expect(before.gatePassed).toBe(true);
    expect(after.gatePassed).toBe(true);
    expect(after.totals).toEqual(before.totals);
    expect(after.lines.map((l) => [l.label, l.amount])).toEqual(before.lines.map((l) => [l.label, l.amount]));
  });

  test('WEEKS only: a null WEEKS is dropped, a trailing minus is negative, the YTD/LTD figures never count', () => {
    const out = normalizeStatementColumns({
      settlement: {
        operating: {
          lines: [
            { section: 'misc', label: 'TOLLS', weeks: '45.10-', ytd: '1,200.00-', ltd: null },
            { section: 'misc', label: 'WIRE CHARGE', weeks: null, ytd: '15.00', ltd: '45.00' },
            { section: 'misc', label: 'LUMPERS', weeks: '', ytd: '300.00', ltd: null },
          ],
          totalLines: [{ label: 'TOTAL MISCELLANEOUS', weeks: '45.10-', ytd: '1,515.00-', ltd: null }],
          recapLines: [
            { label: 'SETTLEMENT TO OPERATOR', weeks: '1,884.73', ytd: '60,100.00', ltd: null },
            { label: 'DIRECT DEPOSIT TO BANK', weeks: '1,884.73', ytd: null, ltd: null },
            { label: 'PRIOR WEEK BALANCE FORWARD', weeks: '1,202.92-', ytd: null, ltd: null },
            { label: 'PERF BD/EMGCY FD', weeks: null, ytd: '500.00', ltd: null },
          ],
          weekTotalMiscellaneous: 9999,
        },
      },
    }) as Extraction;
    const op = out.settlement!.operating as Op;
    expect(op.lines).toEqual([{ section: 'misc', label: 'TOLLS', amount: -45.1, weeks: -45.1, ytd: -1200, ltd: null }]);
    expect(op.totalLines).toEqual([{ label: 'TOTAL MISCELLANEOUS', amount: -45.1, weeks: -45.1, ytd: -1515, ltd: null }]);
    expect(op).toMatchObject({
      weekTotalMiscellaneous: 0,
      settlementToOperator: 1884.73,
      settlementToOperatorLabel: 'SETTLEMENT TO OPERATOR',
      ytdSettlementToOperator: 60100,
      directDeposit: 1884.73,
      directDepositLabel: 'DIRECT DEPOSIT TO BANK',
      priorWeekBalanceForward: -1202.92,
      perfBondEmergencyFundYtd: 500,
    });
  });

  test('a blank SETTLEMENT TO OPERATOR (negative week) stays 0, never another figure', () => {
    const out = normalizeStatementColumns({
      settlement: { operating: { lines: [], totalLines: [{ label: 'TOTAL CASH FLOW', weeks: '812.40-', ytd: null, ltd: null }], recapLines: [{ label: 'SETTLEMENT TO OPERATOR', weeks: null, ytd: '50,000.00', ltd: null }] } },
    }) as Extraction;
    const op = out.settlement!.operating as Op;
    expect(op.settlementToOperator).toBe(0);
    expect(op.directDeposit).toBe(0);
    expect(op.directDepositLabel).toBe('');
  });

  test('a reply in the older shape (lines with amount) is unchanged', () => {
    const e = golden0814();
    expect(normalizeStatementColumns(e)).toBe(e);
  });

  test('YTD continuity is information only: this YTD = last YTD + this WEEKS, per label; a new year compares nothing', () => {
    const prev = { weekEnding: '2026-08-07', rows: [{ label: 'TOTAL REVENUE', weeks: 7000, ytd: 200000 }, { label: 'MILES', weeks: 3000, ytd: 90000 }] };
    const cur = { weekEnding: '2026-08-14', rows: [{ label: 'TOTAL REVENUE', weeks: 7914.1, ytd: 207914.1 }, { label: 'MILES', weeks: 3316, ytd: 93300 }] };
    expect(ytdContinuity(prev, cur)).toEqual([
      { label: 'TOTAL REVENUE', ok: true, difference: 0 },
      { label: 'MILES', ok: false, difference: -16 },
    ]);
    expect(ytdContinuity({ ...prev, weekEnding: '2025-12-26' }, { ...cur, weekEnding: '2026-01-02' })).toEqual([]);
    const saved = [
      { week_ending: '2026-08-14', statement: { unit: '830157', ytd: cur.rows } },
      { week_ending: '2026-08-07', statement: { unit: '830157', ytd: prev.rows } },
    ];
    expect(latestYtdContinuity(saved)?.rows[0]).toEqual({ label: 'TOTAL REVENUE', ok: true, difference: 0 });
    const rows = statementYtdRows(normalizeStatementColumns(asColumnReply(golden0814())) as Extraction);
    expect(rows.find((r) => r.label === 'MILES')).toEqual({ label: 'MILES', weeks: 3316, ytd: 41250 });
  });
});
