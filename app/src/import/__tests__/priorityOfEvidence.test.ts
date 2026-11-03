// PRIORITY OF EVIDENCE (owner decision 2026-11-03, the 6/11-page job, week
// ending 07/24): TOTAL VARIABLE COSTS printed −5,096.21, the variable
// blocks read −4,773.06 (exactly 323.15 short: a whole block — its lines
// and its TOTAL line — was not read), while TOTAL STATEMENT 3,142.36 and
// TOTAL CASH FLOW 2,824.94 tie through a balance forward of −317.42. The
// printed totals tie, so the week is saveable; the subtotal is a
// line-details warning; profit ties to the printed totals.
import { STATEMENT, STATEMENT_LINES, withStatement } from '@/src/data/__tests__/golden0814Fixture';
import { buildPrimeStatementCheck, buildSettlementStatement, settlementDeposit } from '@/src/import/settlementStatement';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { statementWeekOf } from '@/src/stats/statementRoute';

const IMPORT_DATE = '2026-08-15';
const GOLDEN_PROFIT = 4987.74;

// The 08/14 statement with the whole REPAIR block unread (lines and TOTAL
// line): the variable blocks sum 652.53 short of the printed TOTAL
// VARIABLE COSTS — the 07/24 shape.
const noRepairBlock = (op: Partial<typeof STATEMENT> = {}) =>
  withStatement({ lines: STATEMENT_LINES.filter((l) => l.section !== 'repair'), weekTotalRepair: undefined, ...op });

describe('priority of evidence: the printed totals tie', () => {
  test('the subtotal mismatch is a warning, the gate passes', () => {
    const check = buildPrimeStatementCheck(noRepairBlock())!;
    expect(check.checks.find((c) => c.id === 'variableCosts')).toMatchObject({ expected: -3392.25, actual: -2739.72, passed: false });
    expect(check.printedTotalsTie).toBe(true);
    expect(check.gatePassed).toBe(true);
    expect(check.warnings?.map((w) => w.id)).toContain('variableCosts');
  });

  test('the week is saveable with "line details differ"; profit and deposit come from the printed totals', () => {
    const extraction = noRepairBlock();
    const gate = evaluateSettlementGate(extraction, { importDate: IMPORT_DATE });
    expect(gate?.status).toBe('pass');
    if (gate?.status !== 'pass') return;
    expect(gate.lineDetails).toBe('mismatch');
    expect(gate.lineDifference).toBe(-652.53);
    expect(gate.headline).toMatchObject({ revenue: 7914.1, deposited: 3072.57, estimatedProfit: GOLDEN_PROFIT });
  });

  test('profit ties to TOTAL OPERATING EXPENSES through one "lines not read" line', () => {
    const statement = buildSettlementStatement(noRepairBlock(), { savedFlagged: false, priorLabelsSeen: new Set() });
    const week = statementWeekOf({ id: 's', statement })!;
    expect(Math.round((week.gross - week.expenses) * 100) / 100).toBe(GOLDEN_PROFIT);
    expect(week.ledger.filter((e) => e.reason === 'line_residual').map((e) => [e.label, e.printed])).toEqual([['TOTAL VARIABLE COSTS (lines not read)', -652.53]]);
  });

  test('the printed totals do NOT tie (TOTAL STATEMENT misread): the subtotal blocks again', () => {
    const check = buildPrimeStatementCheck(noRepairBlock({ weekTotalStatement: 4375.49 }))!;
    expect(check.printedTotalsTie).toBe(false);
    expect(check.gatePassed).toBe(false);
    const gate = evaluateSettlementGate(noRepairBlock({ weekTotalStatement: 4375.49 }), { importDate: IMPORT_DATE });
    expect(gate).toMatchObject({ status: 'fail', reason: 'statement_check_failed' });
    if (gate?.status === 'fail') expect(gate.failures).toEqual(expect.arrayContaining(['variableCosts', 'statementTotal']));
  });
});

// CARD LOAD CARRIES FORWARD (owner 2026-11-03): a payout printed as AMOUNT
// LOADED ON CARD can come back next week as a negative PRIOR WEEK BALANCE
// FORWARD (07/17 card load 317.42 recovered on 07/24).
describe('card load carries forward', () => {
  test('week A: 317.42 loaded on the card is the deposit, payout method card', () => {
    const weekA = withStatement(
      { priorWeekBalanceForward: 0, weekTotalStatement: 317.42, weekTotalCashFlow: 317.42, settlementToOperator: 317.42, directDeposit: 317.42, payoutMethod: 'card', weekTotalRevenue: 3956.03 } as never,
      { grossRevenue: 3956.03, depositAmount: undefined }
    );
    const check = buildPrimeStatementCheck(weekA)!;
    expect(check.checks.find((c) => c.id === 'directDeposit')).toMatchObject({ expected: 317.42, passed: true });
    const statement = buildSettlementStatement(weekA, { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(statement.printed.payoutMethod).toBe('card');
    expect(settlementDeposit({ statement })).toMatchObject({ deposited: 317.42, owedToCarrier: 0 });
  });

  test('week B: balance forward −317.42; deposited = TOTAL CASH FLOW', () => {
    // 3,142.36 + (−317.42) = 2,824.94 (the 07/24 printed figures).
    const weekB = withStatement(
      { priorWeekBalanceForward: -317.42, weekTotalStatement: 3142.36, weekTotalCashFlow: 2824.94, settlementToOperator: 2824.94, directDeposit: 2824.94, weekTotalRevenue: 3142.36 + 3638.61 },
      { grossRevenue: 3142.36 + 3638.61, depositAmount: undefined }
    );
    const check = buildPrimeStatementCheck(weekB)!;
    expect(check.checks.find((c) => c.id === 'totalCashFlow')).toMatchObject({ expected: 2824.94, actual: 2824.94, passed: true });
    expect(check.printedTotalsTie).toBe(true);
    const statement = buildSettlementStatement(weekB, { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(settlementDeposit({ statement })).toMatchObject({ deposited: 2824.94, owedToCarrier: 0 });
  });
});
