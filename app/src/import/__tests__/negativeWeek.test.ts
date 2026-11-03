// NEGATIVE WEEK (owner decision 2026-11-03). When TOTAL CASH FLOW is
// negative the owner owes Prime: SETTLEMENT TO OPERATOR is 0 or blank and
// no payout line is printed. Chain: TOTAL STATEMENT + balance forward =
// TOTAL CASH FLOW (< 0); owed to carrier = −TOTAL CASH FLOW; deposited = 0;
// checks on lines that were not printed are skipped.
import { withStatement } from '@/src/data/__tests__/golden0814Fixture';
import { buildPrimeStatementCheck, buildSettlementStatement, settlementDeposit } from '@/src/import/settlementStatement';
import { evaluateSettlementGate } from '@/src/import/settlementGate';

const IMPORT_DATE = '2026-08-15';

// The 08/14 statement with a balance forward bigger than the week:
// 4,275.49 + (−5,000.00) = −724.51.
const negative = () =>
  withStatement(
    { priorWeekBalanceForward: -5000, weekTotalCashFlow: -724.51, settlementToOperator: 0, directDeposit: 0 },
    { depositAmount: undefined }
  );

describe('negative week', () => {
  test('the statement chain passes without SETTLEMENT TO OPERATOR or a payout line', () => {
    const check = buildPrimeStatementCheck(negative())!;
    expect(check.negativeWeek).toBe(true);
    expect(check.gateMissing).toEqual([]);
    expect(check.checks.find((c) => c.id === 'totalCashFlow')).toMatchObject({ expected: -724.51, actual: -724.51, passed: true });
    expect(check.checks.some((c) => c.id === 'settlementToOperator' || c.id === 'directDeposit')).toBe(false);
    expect(check.gatePassed).toBe(true);
  });

  test('owed to carrier = −TOTAL CASH FLOW, deposited 0', () => {
    const statement = buildSettlementStatement(negative(), { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(statement.printed.deposit).toBe(-724.51);
    expect(settlementDeposit({ statement })).toEqual({ deposited: 0, owedToCarrier: 724.51, source: 'owed_to_carrier' });
    const gate = evaluateSettlementGate(negative(), { importDate: IMPORT_DATE });
    expect(gate?.status).not.toBe('fail');
    if (gate && gate.status !== 'fail') expect(gate.headline).toMatchObject({ deposited: 0, owedToCarrier: 724.51 });
  });

  test('a negative TOTAL STATEMENT is valid', () => {
    const extraction = withStatement(
      {
        weekTotalRevenue: 3000,
        weekTotalStatement: -638.61,
        weekTotalCashFlow: -1841.53,
        settlementToOperator: 0,
        directDeposit: 0,
      },
      { depositAmount: undefined, grossRevenue: 3000 }
    );
    const check = buildPrimeStatementCheck(extraction)!;
    expect(check.checks.find((c) => c.id === 'statementTotal')).toMatchObject({ expected: -638.61, passed: true });
    expect(check.checks.find((c) => c.id === 'totalCashFlow')).toMatchObject({ expected: -1841.53, passed: true });
    expect(check.gatePassed).toBe(true);
  });

  test('a SETTLEMENT TO OPERATOR printed in a negative week must still tie (|TOTAL CASH FLOW| copied in fails)', () => {
    const check = buildPrimeStatementCheck(withStatement({ priorWeekBalanceForward: -5000, weekTotalCashFlow: -724.51, settlementToOperator: 724.51, directDeposit: 0 }, { depositAmount: undefined }))!;
    expect(check.checks.find((c) => c.id === 'settlementToOperator')).toMatchObject({ passed: false });
    expect(check.gatePassed).toBe(false);
  });
});
