// The golden Prime week (GRWLLG-OY-PrimeInc6, W/E 2026-08-21) as a 6-page
// settlement + operating statement printed across pages 5 and 6, moved
// verbatim from jobEngine.test.ts so the import end-to-end test uses the
// same pages. Not a test file itself.
import type { ChunkExtraction } from '../../../../supabase/functions/ai-import/chunking';

export const LINES_PAGE_5 = [
  ['revenue', 'REVENUE FROM PRIME INC.', 3345.12],
  ['revenue', 'EXTRA PAY', 175],
  ['revenue', 'FUEL SURCG BILL', 1210.04],
  ['revenue', 'REEF FUEL SURCG', 20.82],
  ['revenue', 'SAFETY INC', 16.35],
  ['revenue', 'SERVICE INC', 16.35],
  ['revenue', 'TOLL 1099 PAY', 0.07],
  ['fuel_oil_tax', 'TRACTOR FUEL', -1997.82],
  ['fuel_oil_tax', 'TRACTOR FUEL DISCOUNT', 184.85],
  ['fuel_oil_tax', 'TRACTOR DEF', -95.11],
  ['fuel_oil_tax', 'REEFER FUEL', -46.23],
  ['fuel_oil_tax', 'REEFER FUEL DISCOUNT', 17.92],
  ['fuel_oil_tax', 'DEF DISCOUNT', 29.15],
  ['fuel_oil_tax', 'STATE FUEL TAX', -46.54],
  ['misc', 'TOLLS', -0.25],
  ['misc', 'ADVANCES', -550],
  ['misc', 'WEIGHT TICKETS', -15.25],
  ['misc', 'QUALCOMM COST', -18.34],
  ['misc', 'WIRE CHARGE', -2],
  ['misc', 'TRIP XPRESS CHG', -5],
  ['misc', 'PERSONAL PYMNT RCV', 1],
].map(([section, label, amount]) => ({ section: section as string, label: label as string, amount: amount as number }));
export const LINES_PAGE_6 = [
  ['fixed', 'PHYSICAL DAMAGE INSURANCE', -30.43],
  ['fixed', 'BT/DH INSURANCE', -5.98],
  ['fixed', 'LICENSE AND PERMITS', -100],
  ['fixed', 'STATEMENT PREPARATION', -89.37],
  ['fixed', 'OPERATOR OCCUP ACC', -29.99],
  ['other', 'ACCRUAL PERFORMANCE BOND', -100],
  ['other', 'INTEREST INCOME FROM DEPOST', 0.37],
].map(([section, label, amount]) => ({ section: section as string, label: label as string, amount: amount as number }));

// What one page returns: every field it does not print at its default.
export function page(settlement: Record<string, unknown>, summary = ''): ChunkExtraction {
  return {
    docType: 'settlement',
    summary,
    confidence: 'high',
    settlement: {
      weekEnding: '',
      carrier: '',
      unit: '',
      grossRevenue: 0,
      netPay: 0,
      totalDeductions: 0,
      totalMiles: 0,
      reimbursements: 0,
      deductions: [],
      revenueItems: [],
      reimbursementItems: [],
      operating: {
        lines: [],
        weekMiles: 0,
        weekTotalRevenue: 0,
        weekTotalFuelOilTax: 0,
        weekTotalMiscellaneous: 0,
        weekTotalVariableCosts: 0,
        weekTotalFixedCost: 0,
        weekTotalOtherIncomeAndExpense: 0,
        weekTotalOperatingExpenses: 0,
        weekTotalStatement: 0,
        settlementToOperator: 0,
        directDeposit: 0,
      },
      ...settlement,
    },
  };
}

export const PAGE_1 = page({ weekEnding: '2026-08-21', carrier: 'Prime Inc.', unit: '283940', grossRevenue: 4783.75, netPay: 1884.36, totalMiles: 2327, deductions: [{ code: 'QC', desc: 'QUALCOMM', amount: 18.34 }] });
export const PAGE_2 = page({ deductions: [{ code: 'WT', desc: 'WEIGHT TICKET', amount: 15.25 }] });
export const PAGE_3 = page({ deductions: [{ code: 'WC', desc: 'WIRE CHARGE', amount: 2 }] });
export const PAGE_4 = page({ deductions: [{ code: 'TX', desc: 'TRIP XPRESS', amount: 5 }] });
export const PAGE_5 = page({
  operating: {
    lines: LINES_PAGE_5,
    // The statement page header's week ending (gate, owner decision 2026-10-17).
    weekEnding: '2026-08-21',
    weekTotalRevenue: 4783.75,
    weekTotalFuelOilTax: -1953.78,
    weekTotalMiscellaneous: -589.84,
    weekTotalVariableCosts: -2543.62,
  },
});
export const PAGE_6 = page(
  {
    operating: {
      lines: LINES_PAGE_6,
      weekMiles: 2327,
      weekTotalFixedCost: -255.77,
      weekTotalOtherIncomeAndExpense: -99.63,
      weekTotalOperatingExpenses: -2899.02,
      weekTotalStatement: 1884.73,
      settlementToOperator: 1884.73,
      directDeposit: 1884.73,
    },
  },
  'DIRECT DEPOSIT TO BANK ROUTING #111000025 ACCT # 4455-6677-88 for 1,884.73'
);
export const GOLDEN_PAGES = [PAGE_1, PAGE_2, PAGE_3, PAGE_4, PAGE_5, PAGE_6];

