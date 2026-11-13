// NEGATIVE WEEK WITHOUT A CASH-FLOW SECTION (owner workbook 2026-11-13,
// week ending 07/24): the statement ends at TOTAL STATEMENT -1,155.28 and
// the balance sheet prints DUE TO CARRIER 1,155.28. Owed to carrier is the
// statement's figure, never net due (-1,155.35, before the 0.07 interest).
import { buildSettlementStatement, settlementDeposit } from '@/src/import/settlementStatement';
import { withStatement } from '@/src/data/__tests__/golden0814Fixture';

test('07/24: owed to carrier = -TOTAL STATEMENT when no TOTAL CASH FLOW is printed', () => {
  const e = withStatement(
    {
      lines: [
        { section: 'revenue', label: 'REVENUE FROM PRIME INC.', amount: 5.16 },
        { section: 'fuel_oil_tax', label: 'TRACTOR FUEL', amount: -154.74 },
        { section: 'misc', label: 'ADVANCES', amount: -550 },
        { section: 'fixed', label: 'PHYSICAL DAMAGE INSURANCE', amount: -355.77 },
        { section: 'other', label: 'ACCRUAL PERFORMANCE BOND', amount: -100 },
        { section: 'other', label: 'INTEREST INCOME FROM DEPOSIT', amount: 0.07 },
      ],
      totalLines: [
        { label: 'TOTAL REVENUE', amount: 5.16 },
        { label: 'TOTAL FUEL,OIL,TAX', amount: -154.74 },
        { label: 'TOTAL MISCELLANEOUS', amount: -550 },
        { label: 'TOTAL VARIABLE COSTS', amount: -704.74 },
        { label: 'TOTAL FIXED COST', amount: -355.77 },
        { label: 'TOTAL OTHER INCOME AND EXPENSE', amount: -99.93 },
        { label: 'TOTAL OPERATING EXPENSES', amount: -1160.44 },
        { label: 'TOTAL STATEMENT OF INCOME & EXPENSE', amount: -1155.28 },
      ],
      priorWeekBalanceForward: 0,
      weekTotalCashFlow: 0,
      settlementToOperator: 0,
      directDeposit: 0,
      weekMiles: 0,
    } as never,
    { grossRevenue: 5.16, reimbursements: 0, totalDeductions: 1160.51, netPay: -1155.35, depositAmount: undefined, settlementDateRaw: '26/07/24', statementWeekEndingRaw: '26/07/24', printDateRaw: '7/23/26' }
  );
  const statement = buildSettlementStatement(e, { savedFlagged: false, priorLabelsSeen: new Set() });
  expect(settlementDeposit({ statement })).toEqual({ deposited: 0, owedToCarrier: 1155.28, source: 'owed_to_carrier' });
});
