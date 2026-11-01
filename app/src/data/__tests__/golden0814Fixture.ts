// The golden Prime week W/E 2026-08-14 (profit 4,987.74, balance forward
// 1,202.92-), moved verbatim from goldenPrimeSettlement0814.test.ts so the
// import end-to-end test (src/import/__tests__/importEndToEnd.test.ts) reads
// the same numbers. Not a test file itself.
import type { Extraction, ExtractedSettlementDeduction } from '@/src/import/types';

export const KEY = {
  revenue: 7914.1,
  reimbursements: 462.64,
  deductionsPrinted: 4100.66,
  netDue: 4276.08,
  deposit: 3072.57,
  balanceForward: -1202.92,
  interestExpense: 0.59,
  // variable 3,392.25 − advances 550.00 − meals 62.25 + fixed 145.77 + interest 0.59
  expenses: 2926.36,
  fixed: 145.77,
  profit: 4987.74,
  miles: 3316,
  loadedMiles: 2739,
  emptyMiles: 577,
  rpm: 2.39,
  cpm: 0.88,
  ppm: 1.5,
  deadheadPct: 17.4,
};

export const USER_ID = 'user-1';
export const TRUCK_ID = 'truck-283940';
export const WEEK_ENDING = '2026-08-14';
export const WEEK_START = '2026-08-08';
export const NOW = new Date('2026-08-15T12:00:00');

// ---------------------------------------------------------------------
// PAGES 1-2 — revenue (OWNER REVENUE column), reimbursements, deductions
// ---------------------------------------------------------------------
export const REVENUE_ITEMS = [
  { desc: 'EZ PASS TOLL', order: '', amount: 2.92 }, // ET 0812
  { desc: 'SRV INCENTIVE', order: '', amount: 25 }, // VS 0813
  { desc: 'SFY INCENTIVE', order: '', amount: 25 }, // YS 0813
  { desc: 'FUEL SURCG', order: '4844270', amount: 658.79 }, // FS 0804
  { desc: 'OWNER REVENUE', order: '4844270', amount: 2900.4 }, // RV 0804 (trip rev 4,028.34 × .720)
  { desc: 'Linehaul', order: '4845329', amount: -47.34 }, // RV 0812 "47.34-", no miles
  { desc: 'FUEL SURCG', order: '4902636', amount: 474.35 }, // FS 0807
  { desc: 'OWNER REVENUE', order: '4902636', amount: 1763.24 }, // RV 0807 (2,448.95 × .720)
  { desc: 'FUEL SURCG', order: '4928163', amount: 624.34 }, // FS 0809
  { desc: 'STOP/PICKUP', order: '4928163', amount: 36 }, // PS 0809
  { desc: 'OWNER REVENUE', order: '4928163', amount: 1451.4 }, // RV 0809 (2,015.83 × .720)
];
// The TRIP REVENUE column, which the app read in place of OWNER REVENUE.
export const TRIP_REVENUE: Record<string, number> = { '4844270': 4028.34, '4902636': 2448.95, '4928163': 2015.83 };

export const REIMBURSEMENT_ITEMS = [
  { code: 'LF', desc: 'FED HWY OWN PLATES', ref: '', amount: 100 }, // 0812
  { code: 'MY', desc: 'PHY DAM', ref: '', amount: 10 }, // 0807
  { code: 'SF', desc: 'FUEL TAX ADJUSTMENT', ref: '', amount: 193.12 }, // 0808
  { code: 'RF', desc: 'REEFER FUEL', ref: '4844270', amount: 61.02 }, // 0805
  { code: 'WI', desc: 'WASH INTERIOR', ref: '4902636', amount: 55 }, // 0807
  { code: 'WI', desc: 'WASH INTERIOR', ref: '4928163', amount: 43.5 }, // 0809
];

export const D = (code: string, desc: string, amount: number | string): ExtractedSettlementDeduction => ({ code, desc, amount: amount as number });
// AS 23.50 is the LAST line of page 1; the rest are on page 2.
export const DEDUCTIONS = [
  D('AS', 'ACCOUNTING SERV 0715', 23.5),
  D('AS', 'ACCOUNTING SERV 0719', 65.87),
  D('EZ', 'EZ FAST LN TOLL', 10.46),
  D('FC', 'FUEL CARD CHARGE', 1),
  D('IM', 'IMAGE TRIPS', 5),
  D('LP', 'LICENSE/PERMITS', 100),
  D('MT', 'MAYFR BT/DH INS', 5.98),
  D('MY', 'MAYFAIR PHY DAM', 30.43),
  D('OW', 'OWNER OCCUP ACC', 29.99),
  D('PB', 'PERFORMNCE BOND', 100),
  D('PO', 'NORTH STAR GRILL, MO', 62.25),
  D('PW', 'DRVWYZE WGH STN', 0.98),
  D('QR', 'QUAL/GEO RENTAL', 18.34),
  D('WA', 'ADVANCE EXT WARRANTY PURCHASE', 500),
  D('SH', 'Inv 001060-3554585', 55),
  D('UR', 'Inv 009000-3554243', 597.53),
  D('WA', 'ADVANCE GLOVES ETC', 50),
  // order 4844270
  D('RF', 'REEFER FUEL', 83.93),
  D('RF', 'REEFER FUEL', 58.78),
  D('SF', 'FUEL TAX CHARGES', 24.86),
  D('UE', 'TRACTOR DEF', 28.91),
  D('UE', 'TRACTOR DEF', 24.37),
  D('UF', 'TRACTOR FUEL', 341.04),
  D('UF', 'TRACTOR FUEL', 504.11),
  D('WA', 'ADV FOR WEIGHT TICKETS', 16.25),
  D('WA', 'ADV FOR WEIGHT TICKETS', 6.25),
  // order 4902636
  D('RF', 'REEFER FUEL', 44.87),
  D('RF', 'REEFER FUEL', 59.65),
  D('RF', 'REEFER FUEL', 27.4),
  D('RF', 'REEFER FUEL', 55.58),
  D('SF', 'FUEL TAX CHARGES', 17.9),
  D('UE', 'TRACTOR DEF', 26.96),
  D('UE', 'TRACTOR DEF', 26.66),
  D('UF', 'TRACTOR FUEL', 618.22),
  D('WA', 'ADV FOR WEIGHT TICKETS', 16.25),
  D('WA', 'ADV FOR WEIGHT TICKETS', 6.25),
  D('WI', 'WASH INTERIOR', 55),
  // order 4928163
  D('RF', 'REEFER FUEL', 33.91),
  D('RF', 'REEFER FUEL', 84.47),
  D('SF', 'FUEL TAX CHARGES', 23.56),
  D('UF', 'TRACTOR FUEL', 626.21),
  D('WI', 'WASH INTERIOR', 43.5),
  // credits (the per-line FUEL DISCNT column sums to these; never subtracted again)
  D('UD', 'TRAC FUEL DSCNT', -317.37),
  D('RD', 'REEF FUEL DSCNT', -60.51),
  D('ED', 'DEF DISCOUNT', -32.68),
];

// Three loads. 4845329 (the Linehaul 47.34- adjustment) has no miles.
export const LOADS = [
  { order: '4844270', loadedMiles: 1059, emptyMiles: 184, revenue: 2900.4 },
  { order: '4902636', loadedMiles: 818, emptyMiles: 77, revenue: 1763.24 },
  { order: '4928163', loadedMiles: 862, emptyMiles: 316, revenue: 1451.4 },
];
export const MILELESS_ADJUSTMENT = { order: '4845329', loadedMiles: 0, emptyMiles: 0, revenue: -47.34 };

// ---------------------------------------------------------------------
// PAGES 5-6 — Statement of Income and Expense, WEEKS column, signed as
// printed. MILES (3,316.00) is printed inside the revenue block and the AI
// copied it into the line list — it is miles, never dollars (item 2).
// ---------------------------------------------------------------------
export const STATEMENT_LINES = [
  ['revenue', 'MILES', 3316],
  ['revenue', 'REVENUE FROM PRIME INC.', 6067.7],
  ['revenue', 'PICKUP/STOP OFF PAY', 36],
  ['revenue', 'FUEL SURCG BILL', 1757.48],
  ['revenue', 'SAFETY INC', 25],
  ['revenue', 'SERVICE INC', 25],
  ['revenue', 'TOLL 1099 PAY', 2.92],
  ['fuel_oil_tax', 'TRACTOR FUEL', -2089.58],
  ['fuel_oil_tax', 'TRACTOR FUEL DISCOUNT', 317.37],
  ['fuel_oil_tax', 'TRACTOR DEF', -106.9],
  ['fuel_oil_tax', 'REEFER FUEL', -387.57],
  ['fuel_oil_tax', 'REEFER FUEL DISCOUNT', 60.51],
  ['fuel_oil_tax', 'DEF DISCOUNT', 32.68],
  ['fuel_oil_tax', 'STATE FUEL TAX', 126.8],
  ['repair', 'UNIT REPAIR EXPENSE', -597.53],
  ['repair', 'RO PARTS/REPAIR', -55],
  ['misc', 'TOLLS', -10.46],
  ['misc', 'ADVANCES', -550],
  ['misc', 'WEIGHT TICKETS', -41],
  ['misc', 'QUALCOMM COST', -18.34],
  ['misc', 'WIRE CHARGE', -5],
  ['misc', 'TRIP XPRESS CHG', -5],
  ['misc', 'PRIME POINT-OF-SALE', -62.25],
  ['misc', 'PREPASS WEIGH STATION', -0.98],
  ['fixed', 'PHYSICAL DAMAGE INSURANCE', -20.43],
  ['fixed', 'BT/DH INSURANCE', -5.98],
  ['fixed', 'LICENSE AND PERMITS', -100],
  ['fixed', 'STATEMENT PREPARATION', -89.37],
  ['fixed', 'OPERATOR OCCUP ACC', -29.99],
  ['fixed', 'FEDERAL HWY TAX', 100],
  ['other', 'ACCRUAL PERFORMANCE BOND', -100],
  ['other', 'INTEREST EXPENSE ON OVER DRAW', -0.59],
].map(([section, label, amount]) => ({ section: section as string, label: label as string, amount: amount as number }));

export const STATEMENT = {
  lines: STATEMENT_LINES,
  weekMiles: 3316,
  weekTotalOtherRevenue: 1846.4,
  weekTotalRevenue: 7914.1,
  weekTotalFuelOilTax: -2046.69,
  weekTotalRepair: -652.53,
  weekTotalMiscellaneous: -693.03,
  weekTotalVariableCosts: -3392.25,
  weekTotalFixedCost: -145.77,
  weekTotalOtherIncomeAndExpense: -100.59,
  weekTotalOperatingExpenses: -3638.61,
  weekTotalStatement: 4275.49,
  priorWeekBalanceForward: -1202.92,
  weekTotalCashFlow: 3072.57,
  settlementToOperator: 3072.57,
  directDeposit: 3072.57,
  weekEnding: WEEK_ENDING,
  ytdTotalRevenue: 19642.23,
  ytdMiles: 7819,
  ytdSettlementToOperator: 6214.93,
  weeksInService: 4,
};

export type Settlement0814 = NonNullable<Extraction['settlement']>;

export function golden0814(overrides: Partial<Settlement0814> = {}): Extraction {
  return {
    docType: 'settlement',
    confidence: 'high',
    settlement: {
      weekEnding: WEEK_ENDING,
      // Printed on the real PDF: SETTLEMENT DATE 26/08/14, print DATE
      // 8/13/26, statement WEEK ENDING 26/08/14; CreationDate 2026-08-13.
      settlementDateRaw: '26/08/14',
      printDateRaw: '8/13/26',
      statementWeekEndingRaw: '26/08/14',
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
      // As the AI returned it: the mileless adjustment listed as a "load".
      loads: [LOADS[0], MILELESS_ADJUSTMENT, LOADS[1], LOADS[2]],
      tractorFuel: [],
      reeferFuel: [],
      deductions: DEDUCTIONS,
      // p4 recap: SETTLEMENT GROSS DUE TO/FROM OWNER = DIRECT DEPOSIT.
      depositAmount: KEY.deposit,
      operating: STATEMENT,
      ...overrides,
    },
  };
}
export const withStatement = (op: Partial<typeof STATEMENT>, overrides: Partial<Settlement0814> = {}) =>
  golden0814({ operating: { ...STATEMENT, ...op }, ...overrides });

