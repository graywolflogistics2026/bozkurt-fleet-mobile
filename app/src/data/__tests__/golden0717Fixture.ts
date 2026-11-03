// THIRD GOLDEN SETTLEMENT — Prime Inc, week ending 2026-07-17, the owner's
// FIRST statement (GRWLLG-OY-PrimeInc1.pdf, 8 pages: accounts on page 2,
// interest + recap on page 3, Statement of Income and Expense on pages
// 4-5). Owner transcription 2026-11-03 (IMPORT GATE FIX part 3). Every
// printed total below is the owner's and ties: revenue 1,085.51 +
// reimbursements 8,463.93 − deductions 9,232.02 = net due 317.42 = payout
// 317.42 (AMOUNT LOADED ON CARD) = SETTLEMENT TO OPERATOR = TOTAL STATEMENT.
// It differs from the 8/14 and 8/21 template in four ways: the payout is a
// card, there is NO cash-flow section (no balance forward, no TOTAL CASH
// FLOW), the sections sit on different pages, and the reimbursement section
// holds a personal payment and two advances next to one real reimbursement.
// A loss is a valid result: PROFIT −293.62.
//
// NOT TRANSCRIBED (marked where used): the date texts are in Prime's usual
// format (SETTLEMENT DATE YY/MM/DD, print DATE M/D/YY the day before); the
// fixed-cost lines (only the 75.40 total was given) are one line; the
// lumper, wire and fixed deduction lines carry no printed code. None of
// these change a printed total.
import type { Extraction, ExtractedSettlementDeduction } from '@/src/import/types';

export const KEY = {
  revenue: 1085.51,
  reimbursements: 8463.93,
  deductionsPrinted: 9232.02,
  netDue: 317.42,
  payout: 317.42,
  balanceForward: 0,
  interest: 0,
  // fuel 323.15 + repair 280.22 + lumper 215.00 + Qualcomm 15.72 + wire 2.55
  // + navigation 6.50 + company store 460.59 + fixed 75.40
  expenses: 1379.13,
  fixed: 75.4,
  profit: -293.62,
  miles: 445,
  loadedMiles: 445,
  emptyMiles: 0,
  escrow: 100,
  weeksInService: 1,
  ytdRevenue: 1085.51,
  ytdPaidToOperator: 317.42,
};

export const USER_ID = 'user-1';
export const TRUCK_ID = 'truck-283940';
export const WEEK_ENDING = '2026-07-17';

export const REVENUE_ITEMS = [
  { code: 'RV', desc: 'OWNER REVENUE', order: '4700001', amount: 696.96 },
  { code: 'FS', desc: 'FUEL SURCG', order: '4700001', amount: 173.55 },
  { code: 'LM', desc: 'OUTSIDE LUMPER', order: '4700001', amount: 215 },
];

// The reimbursement section as printed: TOTAL REIMBURSED 8,463.93. Only RF
// is a reimbursement; PR is the owner's own money in, WA the advances taken.
export const REIMBURSEMENT_ITEMS = [
  { code: 'PR', desc: 'PERSONAL PAYMNT', ref: '', amount: 3999 },
  { code: 'WA', desc: 'ADVANCE', ref: '', amount: 3999 },
  { code: 'WA', desc: 'ADVANCE', ref: '', amount: 460.59 },
  { code: 'RF', desc: 'REEFER FUEL', ref: '4700001', amount: 5.34 },
];

export const D = (code: string, desc: string, amount: number): ExtractedSettlementDeduction => ({ code, desc, amount });
// TOTAL DEDUCTIONS FROM TRUCK 9,232.02.
export const DEDUCTIONS = [
  D('UF', 'TRACTOR FUEL', 330.27),
  D('UD', 'TRAC FUEL DSCNT', -7.12),
  D('RF', 'REEFER FUEL', 5.34),
  D('UR', 'TRACTOR REPAIR', 280.22),
  D('', 'LUMPER', 215), // code not transcribed
  D('QR', 'QUAL/GEO RENTAL', 15.72),
  D('', 'WIRE CHARGE', 2.55), // code not transcribed
  D('NQ', 'NAVIGATION', 6.5),
  D('CS', 'COMPANY STORE', 460.59),
  D('PO', 'PRIME POINT OF SALE', 177.55),
  D('EXTEND WR PURCH', 'OPERATOR TRK EXTRAS', 7020),
  D('', 'FIXED COSTS', 75.4), // the fixed lines were transcribed as one total
  D('PB', 'PERFORMNCE BOND', 100),
  D('WA', 'WKLY PYMT OF ADV', 550),
];

export const LOADS = [{ order: '4700001', loadedMiles: 445, emptyMiles: 0, revenue: 696.96 }];

// Statement of Income and Expense, WEEKS column, signed as printed. It ends
// at TOTAL STATEMENT OF INCOME & EXPENSE: no balance forward, no TOTAL CASH
// FLOW.
export const STATEMENT_LINES = [
  ['revenue', 'REVENUE FROM PRIME INC.', 696.96],
  ['revenue', 'FUEL SURCG BILL', 173.55],
  ['revenue', 'OUTSIDE LUMPER 1099 PAY', 215],
  ['fuel_oil_tax', 'TRACTOR FUEL', -330.27],
  ['fuel_oil_tax', 'TRACTOR FUEL DISCOUNT', 7.12],
  ['repair', 'UNIT REPAIR EXPENSE', -280.22],
  ['misc', 'ADVANCES', 3909.59],
  ['misc', 'PERSONAL PYMNT RCV', 3999],
  ['misc', 'OPERATOR TRK EXTRAS', -7020],
  ['misc', 'PRIME POINT-OF-SALE', -177.55],
  ['misc', 'MISCELLANEOUS', -6.5], // the NQ navigation charge
  ['misc', 'LUMPERS', -215],
  ['misc', 'QUALCOMM COST', -15.72],
  ['misc', 'WIRE CHARGE', -2.55],
  ['misc', 'COMPANY STORE', -460.59],
  ['fixed', 'FIXED COSTS', -75.4], // one line for the transcribed total
  ['other', 'ACCRUAL PERFORMANCE BOND', -100],
].map(([section, label, amount]) => ({ section: section as string, label: label as string, amount: amount as number }));

export const STATEMENT = {
  lines: STATEMENT_LINES,
  weekMiles: 445,
  weekTotalFreightRevenue: 696.96,
  weekTotalOtherRevenue: 388.55,
  weekTotalRevenue: 1085.51,
  weekTotalFuelOilTax: -323.15,
  weekTotalRepair: -280.22,
  weekTotalMiscellaneous: 10.68,
  weekTotalVariableCosts: -592.69,
  weekTotalFixedCost: -75.4,
  weekTotalOtherIncomeAndExpense: -100,
  weekTotalOperatingExpenses: -768.09,
  weekTotalStatement: 317.42,
  // No cash-flow section on this statement: the schema defaults (0 = not printed).
  priorWeekBalanceForward: 0,
  weekTotalCashFlow: 0,
  settlementToOperator: 317.42,
  directDeposit: 317.42,
  payoutMethod: 'card',
  weekEnding: WEEK_ENDING,
  ytdTotalRevenue: 1085.51,
  ytdSettlementToOperator: 317.42,
  weeksInService: 1,
  perfBondEmergencyFundYtd: 100,
  escrowPriorBalance: 0,
  escrowThisWeek: 100,
  escrowBalance: 100,
};

export type Settlement0717 = NonNullable<Extraction['settlement']>;

// The page map: sections located by kind, not by page number.
export const PAGE_MAP = [
  { page: 1, kind: 'settlement', role: 'content', status: 'read' },
  { page: 2, kind: 'settlement', role: 'content', status: 'read' },
  { page: 3, kind: 'settlement', role: 'content', status: 'read' },
  { page: 4, kind: 'statement', role: 'content', status: 'read' },
  { page: 5, kind: 'statement', role: 'content', status: 'read' },
  { page: 6, kind: 'delivery_receipt', role: 'stored', status: 'unread' },
  { page: 7, kind: 'delivery_receipt', role: 'stored', status: 'unread' },
  { page: 8, kind: 'other', role: 'stored', status: 'unread' },
] as const;

export function golden0717(overrides: Partial<Settlement0717> = {}, extra: Partial<Extraction> = {}): Extraction {
  return {
    docType: 'settlement',
    confidence: 'high',
    settlement: {
      weekEnding: WEEK_ENDING,
      settlementDateRaw: '26/07/17', // format assumed (Prime's YY/MM/DD)
      printDateRaw: '7/16/26', // assumed: the day before, as on 8/14 and 8/21
      statementWeekEndingRaw: '26/07/17',
      carrier: 'PRIME INC.',
      unit: '283940',
      grossRevenue: KEY.revenue,
      reimbursements: KEY.reimbursements,
      totalDeductions: KEY.deductionsPrinted,
      netPay: KEY.netDue,
      totalMiles: KEY.miles,
      loadedMiles: KEY.loadedMiles,
      perDiemDays: 7,
      revenueItems: REVENUE_ITEMS,
      reimbursementItems: REIMBURSEMENT_ITEMS,
      loads: LOADS,
      tractorFuel: [],
      reeferFuel: [],
      deductions: DEDUCTIONS,
      // Recap: AMOUNT LOADED ON CARD 317.42 (no DIRECT DEPOSIT line).
      depositAmount: KEY.payout,
      payoutMethod: 'card',
      totalLabels: { grossRevenue: 'TOTAL REV', netPay: 'NET AMOUNT DUE UNIT', depositAmount: 'AMOUNT LOADED ON CARD' },
      operating: STATEMENT,
      ...overrides,
    },
    pageMap: PAGE_MAP.map((p) => ({ ...p })),
    pagesTotal: 8,
    ...extra,
  } as Extraction;
}
