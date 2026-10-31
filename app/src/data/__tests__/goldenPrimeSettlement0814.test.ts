// SECOND GOLDEN SETTLEMENT — Prime Inc, unit 283940, week ending
// 2026-08-14 (owner decision 2026-10-17). Next to the 8/21 golden week
// (goldenPrimeSettlement.test.ts), this is the oracle for a week with a
// PRIOR WEEK BALANCE FORWARD, interest EXPENSE, a meal (PRIME POINT-OF-SALE)
// and a mileless linehaul adjustment.
//
// Source: GRWLLG-OY-PrimeInc5.pdf, 17 pages (1-2 settlement, 3 accounts,
// 4 interest + recap, 5-6 Statement of Income and Expense, 7-17
// attachments), transcribed by hand by the owner. Every amount below is
// from that transcription and ties to Prime's printed totals: revenue
// 7,914.10; reimbursements 462.64; deductions 4,100.66; net due 4,276.08;
// deposit 3,072.57. Where the transcription gave only a code and an amount,
// the description is that code's printed label (docs/CARRIER_CODES.md).
// None of these numbers may change without a fresh hand check.
import type { Extraction, ExtractedSettlementDeduction } from '@/src/import/types';
import type { Deduction, FuelPurchase, Load, Reimbursement, Settlement } from '@/src/types/db';

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    async bytes() {
      return new Uint8Array();
    }
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { saveExtraction } from '@/src/data/aiImportSave';
import { computeKpis, type KpiResult } from '@/src/stats/kpi';
import { buildPeriodScopedCpm } from '@/src/stats/periodScopedCpm';
import { buildWeeklyTrueProfitTrend, calcTrueProfit } from '@/src/stats/trueProfit';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { buildTruckComparison, type ComparisonTruck } from '@/src/stats/truckComparison';
import { checkSettlementReconciliation } from '@/src/import/settlementReconciliation';
import { buildPrimeStatementCheck, settlementDeposit, settlementVerification } from '@/src/import/settlementStatement';
import { splitPrimeLoads } from '@/src/import/primeLoads';
import { sanitizeExtractionDates } from '@/src/import/dateGuard';
import { readPrimeYtdSnapshotFromParsedJson } from '@/src/import/primeOperatingStatement';
import { buildPrimeGroupChecks } from '@/src/import/primeLineGroups';
import { buildReviewVerdict, isOlderReading, isSaveBlocked, lineDetailsDifference, markReviewWarnings, reviewInputsOf } from '@/src/import/reviewVerdict';

// ---------------------------------------------------------------------
// ANSWER KEY (owner, independently verified)
// ---------------------------------------------------------------------
const KEY = {
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

const USER_ID = 'user-1';
const TRUCK_ID = 'truck-283940';
const WEEK_ENDING = '2026-08-14';
const WEEK_START = '2026-08-08';
const NOW = new Date('2026-08-15T12:00:00');

// ---------------------------------------------------------------------
// PAGES 1-2 — revenue (OWNER REVENUE column), reimbursements, deductions
// ---------------------------------------------------------------------
const REVENUE_ITEMS = [
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
const TRIP_REVENUE: Record<string, number> = { '4844270': 4028.34, '4902636': 2448.95, '4928163': 2015.83 };

const REIMBURSEMENT_ITEMS = [
  { code: 'LF', desc: 'FED HWY OWN PLATES', ref: '', amount: 100 }, // 0812
  { code: 'MY', desc: 'PHY DAM', ref: '', amount: 10 }, // 0807
  { code: 'SF', desc: 'FUEL TAX ADJUSTMENT', ref: '', amount: 193.12 }, // 0808
  { code: 'RF', desc: 'REEFER FUEL', ref: '4844270', amount: 61.02 }, // 0805
  { code: 'WI', desc: 'WASH INTERIOR', ref: '4902636', amount: 55 }, // 0807
  { code: 'WI', desc: 'WASH INTERIOR', ref: '4928163', amount: 43.5 }, // 0809
];

const D = (code: string, desc: string, amount: number | string): ExtractedSettlementDeduction => ({ code, desc, amount: amount as number });
// AS 23.50 is the LAST line of page 1; the rest are on page 2.
const DEDUCTIONS = [
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
const LOADS = [
  { order: '4844270', loadedMiles: 1059, emptyMiles: 184, revenue: 2900.4 },
  { order: '4902636', loadedMiles: 818, emptyMiles: 77, revenue: 1763.24 },
  { order: '4928163', loadedMiles: 862, emptyMiles: 316, revenue: 1451.4 },
];
const MILELESS_ADJUSTMENT = { order: '4845329', loadedMiles: 0, emptyMiles: 0, revenue: -47.34 };

// ---------------------------------------------------------------------
// PAGES 5-6 — Statement of Income and Expense, WEEKS column, signed as
// printed. MILES (3,316.00) is printed inside the revenue block and the AI
// copied it into the line list — it is miles, never dollars (item 2).
// ---------------------------------------------------------------------
const STATEMENT_LINES = [
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

const STATEMENT = {
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

type Settlement0814 = NonNullable<Extraction['settlement']>;

function golden0814(overrides: Partial<Settlement0814> = {}): Extraction {
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
const withStatement = (op: Partial<typeof STATEMENT>, overrides: Partial<Settlement0814> = {}) =>
  golden0814({ operating: { ...STATEMENT, ...op }, ...overrides });

// Prime codes this week uses, as docs/CARRIER_CODES.md / carrier_code_maps
// (§52) seed them.
const PRIME_CODES = [
  ['AS', 'MISC 16', 'ACCOUNTING SERVICE', 'Legal & Professional Services', true],
  ['EZ', null, 'EZ FAST LN TOLL', 'Tolls & Scales', true],
  ['FC', 'MISC 15', 'FUEL CARD CHG', 'Bank & Merchant Fees', true],
  ['IM', 'FDEX 02', 'IMAGE TRIPS', 'ELD & Communications', true],
  ['LP', 'PRMT 01', 'LICENSE/PERMITS', 'Permits, Licenses & Road Taxes', true],
  ['OW', null, 'OWNER OCCUP ACC', 'Insurance—Health', true],
  ['PB', null, 'P/B ADJUSTMENT', 'Escrow & Deposits', false],
  ['PO', 'PPOS 01', 'POINT OF SALE', 'Meals (per diem covered)', false],
  ['PW', null, 'PASS WEIGHT STN', 'Tolls & Scales', true],
  ['QR', null, 'QUALCOMM RENTAL', 'ELD & Communications', true],
  ['RD', null, 'REEF FUEL DSCNT', null, null],
  ['RF', 'FUEL 02', 'REEFER FUEL', 'Fuel & DEF', true],
  ['UD', null, 'TRAC FUEL DSCNT', null, null],
  ['UE', 'FUEL 03', 'TRACTOR DEF', 'Fuel & DEF', true],
  ['UF', 'FUEL 01', 'TRACTOR FUEL', 'Fuel & DEF', true],
  ['UR', 'REPR 01', 'TRACTOR REPAIR', 'Maintenance & Repairs', true],
  ['WA', 'ADV 01', 'ADVANCE', 'Advance Repayment', false],
  ['WI', 'WASH 02', 'WASH INTERIOR', 'Truck Wash & Detailing', true],
  ['WT', 'WGT 01', 'WEIGHT TICKETS', 'Tolls & Scales', true],
].map(([code, sub_code, label, category, is_deductible]) => ({
  carrier: 'PRIME INC',
  code,
  sub_code,
  label,
  description: null,
  category,
  is_deductible,
  income_or_chargeback: null,
  notes: null,
}));

type Rows = { settlements: Settlement[]; loads: Load[]; deductions: Deduction[]; fuel: FuelPurchase[]; reimbursements: Reimbursement[] };

async function importWeek(extraction: Extraction): Promise<Rows> {
  mockClient = createFakeSupabase({
    profiles: [{ user_id: USER_ID, business_balance: 0 }],
    carrier_code_maps: PRIME_CODES,
  });
  await saveExtraction({
    importDate: '2026-10-29',
    extraction,
    userId: USER_ID,
    truckId: TRUCK_ID,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'pdf',
    mediaType: 'application/pdf',
    createContribution: false,
  });
  const store = mockClient.__store as Record<string, unknown[]>;
  return {
    settlements: (store.settlements ?? []) as Settlement[],
    loads: (store.loads ?? []) as Load[],
    deductions: (store.deductions ?? []) as Deduction[],
    fuel: (store.fuel_purchases ?? []) as FuelPurchase[],
    reimbursements: (store.reimbursements ?? []) as Reimbursement[],
  };
}

const TRUCK: ComparisonTruck = {
  id: TRUCK_ID,
  unit_number: '283940',
  cost_basis_ownership_mode: null,
  purchase_price: null,
  cost_basis_loan_monthly_payment: null,
  cost_basis_paid_spread_months: null,
  cost_basis_warranty_cost: null,
  cost_basis_warranty_term_months: null,
};

function weekKpi(rows: Rows, truckScope: string | null = TRUCK_ID): KpiResult {
  return computeKpis({
    trucks: [TRUCK],
    settlements: rows.settlements,
    loads: rows.loads,
    deductions: rows.deductions,
    fuelPurchases: rows.fuel,
    maintenanceRecords: [],
    tolls: [],
    reimbursements: rows.reimbursements,
    truckScope,
    window: { startIso: WEEK_START, endIso: WEEK_ENDING },
  });
}

const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
const failedChecks = (e: Extraction) => buildPrimeStatementCheck(e)!.checks.filter((c) => !c.passed).map((c) => c.id);

// =====================================================================
describe('golden week 2026-08-14 — Verified by Prime statement, every screen shows the answer key', () => {
  let rows: Rows;
  beforeAll(async () => {
    rows = await importWeek(golden0814());
  });

  test('every import check passes; every core statement check ran and passed; the week is Verified', () => {
    expect(checkSettlementReconciliation(golden0814())).toEqual({ ok: true, issues: [] });
    const check = buildPrimeStatementCheck(golden0814())!;
    expect(check.checks.filter((c) => !c.passed)).toEqual([]);
    expect(check.coreMissing).toEqual([]);
    expect(check.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['revenueLines', 'grossMatches', 'operatingExpenses', 'statementTotal', 'totalCashFlow', 'settlementToOperator', 'directDeposit', 'milesMatch', 'statementWeekEnding'])
    );
    expect(rows.settlements[0].statement?.source).toBe('prime_statement');
    expect(rows.settlements[0].statement?.reviewReasons).toEqual([]);
    expect(settlementVerification(rows.settlements[0])).toBe('verified_prime');
  });

  test('computeKpis(): revenue 7,914.10, expenses 2,926.36, profit 4,987.74, miles 3,316, RPM 2.39 / cost 0.88 / profit 1.50, deadhead 17.4%', () => {
    for (const scope of [TRUCK_ID, null]) {
      const k = weekKpi(rows, scope);
      expect(r2(k.gross)).toBe(KEY.revenue);
      expect(r2(k.expenses.total)).toBe(KEY.expenses);
      expect(r2(k.net)).toBe(KEY.profit);
      expect(k.miles.total).toBe(KEY.miles);
      expect(k.miles.loaded).toBe(KEY.loadedMiles);
      expect(k.miles.empty).toBe(KEY.emptyMiles);
      expect(Math.round(k.miles.deadheadPct! * 1000) / 10).toBe(KEY.deadheadPct);
      expect(r2(k.rpm)).toBe(KEY.rpm);
      expect(r2(k.cpm)).toBe(KEY.cpm);
      expect(r2(k.ppm)).toBe(KEY.ppm);
      expect(k.deposits).toBe(KEY.deposit);
    }
  });

  test('fixed cost 145.77 keeps printed signs (FEDERAL HWY TAX +100.00 is a credit); variable 2,780.59', () => {
    const k = weekKpi(rows);
    expect(r2(k.expenses.fixed)).toBe(KEY.fixed);
    expect(r2(k.expenses.variable)).toBe(r2(KEY.expenses - KEY.fixed));
    const fedHwy = k.ledger.find((r) => r.label === 'FEDERAL HWY TAX')!;
    expect(fedHwy.status).toBe('offset');
    expect(fedHwy.amount).toBe(100);
  });

  test('excluded from profit: advances 550.00, meals 62.25 (D4), bond 100.00; interest expense 0.59 counts', () => {
    const k = weekKpi(rows);
    const excluded = k.ledger.filter((r) => r.status === 'excluded').map((r) => [r.label, r.amount, r.reason]);
    expect(excluded).toEqual([
      ['ADVANCES', 550, 'advance'],
      ['PRIME POINT-OF-SALE', 62.25, 'meals_per_diem'],
      ['ACCRUAL PERFORMANCE BOND', 100, 'escrow'],
    ]);
    expect(k.ledger.find((r) => r.label === 'INTEREST EXPENSE ON OVER DRAW')).toMatchObject({ status: 'counted', amount: 0.59 });
    // MILES is not a dollar line and never reaches the ledger.
    expect(k.ledger.some((r) => r.label === 'MILES')).toBe(false);
  });

  test('bridge: 3,072.57 + 1,202.92 + 550.00 + 62.25 + 100.00 = 4,987.74, nothing unexplained', () => {
    const b = weekKpi(rows).bridge;
    expect(b.depositStart).toBe(KEY.deposit);
    expect(b.balanceForward).toBe(1202.92);
    expect(b.statementAddBacks.map((a) => [a.label, a.amount])).toEqual([
      ['ADVANCES', 550],
      ['PRIME POINT-OF-SALE', 62.25],
      ['ACCRUAL PERFORMANCE BOND', 100],
    ]);
    expect(b.interestIncome).toBe(0);
    expect(b.difference).toBe(0);
    expect(r2(b.profit)).toBe(KEY.profit);
  });

  test('deposit is read: 3,072.57 from SETTLEMENT TO OPERATOR (gate passed, item 6), never computed', () => {
    expect(rows.settlements[0].statement?.printed).toMatchObject({ deposit: KEY.deposit, depositSource: 'settlement_to_operator', balanceForward: KEY.balanceForward, interestNet: -KEY.interestExpense });
    expect(settlementDeposit(rows.settlements[0])).toEqual({ deposited: KEY.deposit, owedToCarrier: 0, source: 'settlement_to_operator' });
  });

  test('Home, weekly trend, Profit Analysis, Per-Truck and calcTrueProfit all give 4,987.74', () => {
    const home = buildPeriodScopedCpm('thisWeek', [WEEK_ENDING], [TRUCK], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements, TRUCK_ID, null, NOW);
    expect(r2(home.kpi!.net)).toBe(KEY.profit);
    expect(home.kpi!.deposits).toBe(KEY.deposit);
    expect(r2(home.cpm!.revenuePerMile)).toBe(KEY.rpm);
    expect(r2(home.cpm!.costPerMile)).toBe(KEY.cpm);
    expect(r2(home.cpm!.profitPerMile)).toBe(KEY.ppm);
    const trend = buildWeeklyTrueProfitTrend(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements);
    expect(trend).toHaveLength(1);
    expect(r2(trend[0].net)).toBe(KEY.profit);
    const pa = buildProfitAnalysis(rows.settlements, rows.fuel, [], rows.deductions, rows.reimbursements, WEEK_START, NOW, []);
    expect(r2(pa.revenue)).toBe(KEY.revenue);
    expect(r2(pa.totalExpenses)).toBe(KEY.expenses);
    expect(r2(pa.netIncome)).toBe(KEY.profit);
    const row = buildTruckComparison([TRUCK], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements).rows[0];
    expect(r2(row.netProfit)).toBe(KEY.profit);
    expect(r2(calcTrueProfit(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements))).toBe(KEY.profit);
  });

  test('PO fix: the printed code PO makes "NORTH STAR GRILL, MO" a meal on the line route too; lines vs statement differ only by the 0.59 interest', async () => {
    // Prime books the fuel card under WIRE CHARGE and splits the weight
    // tickets, so lines reconcile at total level only. The interest expense
    // exists only on the statement: 0.59, under the $1 cross-check tolerance.
    const meal = rows.deductions.find((d) => d.description === 'NORTH STAR GRILL, MO')!;
    expect(meal.category).toBe('Meals (per diem covered)');
    const k = weekKpi(rows);
    expect(k.bridge.crossChecks).toEqual([]);
    // The line route alone (no statement page): 4,987.74 + 0.59 interest
    // that only the statement carries.
    const lineRows = await importWeek(golden0814({ operating: undefined }));
    const line = weekKpi(lineRows);
    expect(settlementVerification(lineRows.settlements[0])).toBe('totals_match');
    expect(r2(line.expenses.total)).toBe(r2(KEY.expenses - KEY.interestExpense));
    expect(r2(line.net)).toBe(r2(KEY.profit + KEY.interestExpense));
  });
});

// =====================================================================
describe('balance forward (owner decision 2026-10-17)', () => {
  test('cash chain: TOTAL STATEMENT 4,275.49 + (−1,202.92) = TOTAL CASH FLOW 3,072.57 = SETTLEMENT TO OPERATOR = DIRECT DEPOSIT', () => {
    const check = buildPrimeStatementCheck(golden0814())!;
    const byId = Object.fromEntries(check.checks.map((c) => [c.id, c]));
    expect(byId.statementTotal).toMatchObject({ expected: 4275.49, actual: 4275.49, passed: true });
    expect(byId.totalCashFlow).toMatchObject({ expected: 3072.57, actual: 3072.57, passed: true });
    expect(byId.settlementToOperator).toMatchObject({ expected: 3072.57, actual: 3072.57, passed: true });
    expect(byId.directDeposit).toMatchObject({ expected: 3072.57, actual: 3072.57, passed: true });
  });

  test('deposit identity: net due 4,276.08 − 1,202.92 − interest expense 0.59 = 3,072.57', () => {
    expect(r2(KEY.netDue + KEY.balanceForward - KEY.interestExpense)).toBe(KEY.deposit);
    expect(checkSettlementReconciliation(golden0814()).issues).toEqual([]);
  });

  test('the balance forward read as a line (no dedicated field) is the balance forward, never an expense', async () => {
    const lines = [...STATEMENT_LINES, { section: 'other', label: 'PRIOR WEEK BALANCE FORWARD', amount: -1202.92 }];
    const e = withStatement({ lines, priorWeekBalanceForward: undefined });
    expect(failedChecks(e)).toEqual([]);
    expect(checkSettlementReconciliation(e).ok).toBe(true);
    const rows = await importWeek(e);
    expect(r2(weekKpi(rows).net)).toBe(KEY.profit);
    expect(weekKpi(rows).bridge.balanceForward).toBe(1202.92);
    expect(weekKpi(rows).bridge.difference).toBe(0);
  });

  test('the other direction: Prime pays out a balance it owed you (+200.00) — deposit up, profit unchanged (constructed from the golden week)', async () => {
    const deposit = 4475.49; // 4,275.49 + 200.00
    const e = withStatement(
      { priorWeekBalanceForward: 200, weekTotalCashFlow: deposit, settlementToOperator: deposit, directDeposit: deposit },
      { depositAmount: deposit }
    );
    expect(failedChecks(e)).toEqual([]);
    expect(checkSettlementReconciliation(e).ok).toBe(true); // 4,276.08 + 200.00 − 0.59
    const rows = await importWeek(e);
    const k = weekKpi(rows);
    expect(r2(k.net)).toBe(KEY.profit);
    expect(k.deposits).toBe(deposit);
    expect(k.bridge.balanceForward).toBe(-200);
    expect(k.bridge.difference).toBe(0);
  });

  test('a week without any balance forward keeps the old chain (the 8/21 golden week is unchanged)', () => {
    const e = withStatement({ priorWeekBalanceForward: undefined, weekTotalCashFlow: undefined, settlementToOperator: 4275.49, directDeposit: 4275.49 }, { depositAmount: 4275.49 });
    expect(failedChecks(e)).toEqual([]);
  });
});

// =====================================================================
describe('a deliberately misread number still blocks Save', () => {
  test('the balance forward read unsigned from page 3 (+1,202.92) breaks the cash chain', () => {
    expect(failedChecks(withStatement({ priorWeekBalanceForward: 1202.92 }))).toEqual(['totalCashFlow']);
    expect(checkSettlementReconciliation(withStatement({ priorWeekBalanceForward: 1202.92 })).issues.map((i) => i.type)).toEqual(['depositMismatch']);
    // TOTAL CASH FLOW not read either: SETTLEMENT TO OPERATOR catches it.
    expect(failedChecks(withStatement({ priorWeekBalanceForward: 1202.92, weekTotalCashFlow: undefined }))).toEqual(['settlementToOperator']);
  });

  test('the balance forward missed entirely breaks the cash chain', () => {
    expect(failedChecks(withStatement({ priorWeekBalanceForward: undefined }))).toEqual(['totalCashFlow']);
    expect(failedChecks(withStatement({ priorWeekBalanceForward: undefined, weekTotalCashFlow: undefined }))).toEqual(['settlementToOperator']);
    expect(checkSettlementReconciliation(withStatement({ priorWeekBalanceForward: undefined })).issues.map((i) => i.type)).toEqual(['depositMismatch']);
  });

  test('one misread statement line fails its section check', () => {
    const lines = STATEMENT_LINES.map((l) => (l.label === 'TRACTOR FUEL' ? { ...l, amount: -2422.12 } : l));
    expect(failedChecks(withStatement({ lines }))).toEqual(['section_fuel_oil_tax']);
  });

  test('a misread deposit fails the deposit check and DIRECT DEPOSIT = SETTLEMENT TO OPERATOR', () => {
    expect(failedChecks(withStatement({ directDeposit: 3027.57 }))).toEqual(['directDeposit']);
    expect(checkSettlementReconciliation(golden0814({ depositAmount: 3027.57 })).issues).toEqual([
      { type: 'depositMismatch', stated: 3027.57, computed: expect.closeTo(3072.57, 2) },
    ]);
  });

  test('the statement week ending must be EXACTLY the settlement week ending (2026-10-29: the year/day-swap tolerance is removed)', () => {
    expect(failedChecks(withStatement({}, { statementWeekEndingRaw: '26/08/21' }))).toEqual(['statementWeekEnding']);
    // An older reading (no printed text) that stored "26/08/14" as
    // 2014-08-26 no longer passes as "the same week".
    expect(failedChecks(withStatement({ weekEnding: '2014-08-26' }, { statementWeekEndingRaw: undefined }))).toEqual(['statementWeekEnding']);
    expect(failedChecks(withStatement({ weekEnding: '2026-08-14' }, { statementWeekEndingRaw: undefined }))).toEqual([]);
  });
});

// =====================================================================
describe('MILES is not dollars (item 2)', () => {
  test('the MILES row inside the revenue block never enters a dollar sum (7,914.10, not 11,230.10)', () => {
    const check = buildPrimeStatementCheck(golden0814())!;
    expect(check.checks.find((c) => c.id === 'revenueLines')).toMatchObject({ expected: 7914.1, actual: 7914.1, passed: true });
    expect(check.lines.some((l) => l.label === 'MILES')).toBe(false);
  });

  test('without weekMiles printed, the MILES row still feeds the miles check', () => {
    const check = buildPrimeStatementCheck(withStatement({ weekMiles: undefined }))!;
    expect(check.checks.find((c) => c.id === 'milesMatch')).toMatchObject({ expected: 3316, actual: 3316, passed: true });
  });
});

// =====================================================================
describe('revenue column and loads (items 3-4)', () => {
  test('the app\'s 10,386.86 = TRIP REVENUE in place of OWNER REVENUE plus "47.34-" read as +47.34 — caught at import', () => {
    const misread = REVENUE_ITEMS.map((r) =>
      r.desc === 'OWNER REVENUE' ? { ...r, amount: TRIP_REVENUE[r.order] } : r.desc === 'Linehaul' ? { ...r, amount: 47.34 } : r
    );
    const result = checkSettlementReconciliation(golden0814({ revenueItems: misread }));
    expect(result.issues).toEqual([{ type: 'revenueLinesMismatch', stated: 7914.1, summed: expect.closeTo(10386.86, 2) }]);
  });

  test('three loads are saved (4844270, 4902636, 4928163); the mileless Linehaul 47.34- is an adjustment, never a load', async () => {
    const rows = await importWeek(golden0814());
    expect(rows.loads.map((l) => l.order_number)).toEqual(['4844270', '4902636', '4928163']);
    expect(rows.loads.map((l) => l.revenue)).toEqual([2900.4, 1763.24, 1451.4]);
    const split = splitPrimeLoads(golden0814())!;
    expect(split.adjustments).toEqual([{ order: '4845329', desc: null, amount: -47.34 }]);
    // 2,900.40 + 1,763.24 + 1,451.40 − 47.34 = REVENUE FROM PRIME INC. 6,067.70
    expect(r2(split.loadRevenue + split.adjustmentTotal)).toBe(6067.7);
    expect(split.statementRevenue).toBe(6067.7);
    expect(split.matches).toBe(true);
  });

  test('the adjustment printed only as a revenue line (not under loads) still counts', () => {
    const split = splitPrimeLoads(golden0814({ loads: LOADS }))!;
    expect(split.adjustments).toEqual([{ order: '4845329', desc: 'Linehaul', amount: -47.34 }]);
    expect(split.matches).toBe(true);
  });

  test('loads that do not add up to REVENUE FROM PRIME INC. are flagged and keep no revenue; profit stays the statement\'s', async () => {
    const tripRevenueLoads = LOADS.map((l) => ({ ...l, revenue: TRIP_REVENUE[l.order] }));
    const e = golden0814({ loads: tripRevenueLoads });
    expect(splitPrimeLoads(e)!.matches).toBe(false);
    const rows = await importWeek(e);
    expect(rows.loads.map((l) => l.revenue)).toEqual([0, 0, 0]);
    expect(rows.settlements[0].statement?.reviewReasons.map((r) => r.reason)).toEqual(['loads_revenue_mismatch']);
    expect(r2(weekKpi(rows).net)).toBe(KEY.profit);
    expect(weekKpi(rows).miles.loaded).toBe(KEY.loadedMiles);
  });
});

// =====================================================================
describe('continuity with the 8/21 golden week', () => {
  // The 8/21 week's printed figures (goldenPrimeSettlement.test.ts STATEMENT).
  const WEEK_0821 = { revenue: 4783.75, settlementToOperator: 1884.73, miles: 2327 };
  const YTD_0821 = { revenue: 24425.98, paidToOperator: 8099.66, miles: 10146 };

  test('YTD on 8/14 + the 8/21 week = YTD on 8/21 (revenue, paid to operator, miles)', () => {
    const snapshot = readPrimeYtdSnapshotFromParsedJson(golden0814() as unknown as Record<string, unknown>, WEEK_ENDING)!;
    expect(snapshot.revenue).toBe(19642.23);
    expect(snapshot.miles).toBe(7819);
    expect(r2(snapshot.revenue + WEEK_0821.revenue)).toBe(YTD_0821.revenue);
    expect(r2(STATEMENT.ytdSettlementToOperator + WEEK_0821.settlementToOperator)).toBe(YTD_0821.paidToOperator);
    expect(snapshot.miles + WEEK_0821.miles).toBe(YTD_0821.miles);
  });
});

// =====================================================================
// ITEM 5 — per-group checks (warnings only)
// =====================================================================
describe('per-group checks: settlement lines vs the statement (item 5)', () => {
  test('every group ties on the real week; the total differs only by the 0.59 interest', () => {
    const groups = buildPrimeGroupChecks(golden0814())!;
    expect(groups.map((g) => [g.group, g.settlement, g.statement, g.passed])).toEqual([
      ['tractor_fuel', 2089.58, 2089.58, true],
      ['tractor_def', 106.9, 106.9, true],
      ['reefer_fuel', 387.57, 387.57, true], // 448.59 − reimbursement 61.02
      ['tractor_fuel_discount', -317.37, -317.37, true],
      ['reefer_fuel_discount', -60.51, -60.51, true],
      ['def_discount', -32.68, -32.68, true],
      ['state_fuel_tax', -126.8, -126.8, true], // 66.32 − reimbursement 193.12
      ['repair', 652.53, 652.53, true],
      ['advances', 550, 550, true], // weight-ticket advances left out
      ['meals', 62.25, 62.25, true],
      ['performance_bond', 100, 100, true],
      ['total', 3638.02, 3638.61, true], // 4,100.66 − 462.64 vs TOTAL OPERATING EXPENSES
    ]);
    expect(groups.find((g) => g.group === 'total')!.difference).toBe(-0.59);
  });

  test('a misread tractor fuel line names its group and the difference (constructed: +332.54 on one UF line)', () => {
    const deductions = DEDUCTIONS.map((d) => (d.code === 'UF' && d.amount === 341.04 ? { ...d, amount: 673.58 } : d));
    const groups = buildPrimeGroupChecks(golden0814({ deductions }))!;
    expect(groups.filter((g) => !g.passed).map((g) => [g.group, g.difference])).toEqual([
      ['tractor_fuel', 332.54],
      ['total', 331.95],
    ]);
  });
});

// =====================================================================
// ITEM 6 — the gate
// =====================================================================
describe('the gate (item 6): statement checks + week ending decide; line items only warn', () => {
  // The extraction misread the line items (constructed from the golden
  // week: one tractor fuel line +332.54 and the TRIP REVENUE column), but
  // read Prime's statement correctly.
  const misreadLines = () =>
    golden0814({
      deductions: DEDUCTIONS.map((d) => (d.code === 'UF' && d.amount === 341.04 ? { ...d, amount: 673.58 } : d)),
      revenueItems: REVENUE_ITEMS.map((r) => (r.desc === 'OWNER REVENUE' ? { ...r, amount: TRIP_REVENUE[r.order] } : r)),
      grossRevenue: 10386.86,
    });

  test('gate passes -> Save is not blocked, verdict amber "line details differ", profit from the statement', () => {
    const e = misreadLines();
    expect(checkSettlementReconciliation(e).ok).toBe(false);
    expect(buildPrimeStatementCheck(e)!.gatePassed).toBe(true);
    expect(buildPrimeStatementCheck(e)!.warnings!.map((w) => w.id)).toEqual(['grossMatches']);
    expect(isSaveBlocked(e)).toBe(false);
    const verdict = buildReviewVerdict(e, { saveBlocked: false })!;
    expect(verdict).toMatchObject({ tone: 'amber', kind: 'needs_look', profit: KEY.profit, deposit: KEY.deposit });
    expect(verdict.kind === 'needs_look' && verdict.reason.kind).toBe('line_details_differ');
  });

  test('saved: Verified, gross = TOTAL REVENUE (not the header 10,386.86), net due printed, needs-review', async () => {
    const rows = await importWeek(markReviewWarnings(misreadLines()));
    const st = rows.settlements[0];
    expect(settlementVerification(st)).toBe('verified_prime');
    expect(st.gross).toBe(KEY.revenue);
    expect(st.net).toBe(KEY.netDue);
    expect(st.statement?.reviewReasons.map((r) => r.reason)).toEqual(['statement_warning', 'line_details_differ']);
    expect(r2(weekKpi(rows).net)).toBe(KEY.profit);
    expect(weekKpi(rows).deposits).toBe(KEY.deposit);
  });

  test('(d) loads keep revenue only if the loads check passes', async () => {
    const owner = await importWeek(golden0814());
    expect(owner.loads.map((l) => l.revenue)).toEqual([2900.4, 1763.24, 1451.4]);
    const trip = await importWeek(golden0814({ loads: LOADS.map((l) => ({ ...l, revenue: TRIP_REVENUE[l.order] })) }));
    expect(trip.loads.map((l) => l.revenue)).toEqual([0, 0, 0]);
  });

  test('the difference is the largest line-item or group difference', () => {
    expect(lineDetailsDifference(reviewInputsOf(golden0814()))).toBeNull();
    // revenue lines 10,386.86 vs printed 7,914.10
    expect(lineDetailsDifference(reviewInputsOf(misreadLines()))).toBe(2472.76);
  });

  test("gate fails (a statement line misread) -> today's guard: Save blocked, verdict red naming the check", () => {
    const lines = STATEMENT_LINES.map((l) => (l.label === 'TRACTOR FUEL' ? { ...l, amount: -2422.12 } : l));
    const e = withStatement({ lines });
    expect(buildPrimeStatementCheck(e)!.gatePassed).toBe(false);
    expect(isSaveBlocked(e)).toBe(true);
    expect(buildReviewVerdict(e, { saveBlocked: true })).toMatchObject({
      tone: 'red',
      kind: 'not_verified',
      reason: { kind: 'statement_check_failed', check: { id: 'section_fuel_oil_tax' } },
    });
  });

  test('a statement week ending that was not read fails the gate (never skipped)', () => {
    const e = withStatement({ weekEnding: undefined }, { statementWeekEndingRaw: undefined });
    expect(buildPrimeStatementCheck(e)!.gatePassed).toBe(false);
    expect(buildPrimeStatementCheck(e)!.gateMissing).toEqual(['statementWeekEnding']);
    expect(buildReviewVerdict(e, { saveBlocked: isSaveBlocked(e) })).toMatchObject({
      tone: 'red',
      reason: { kind: 'statement_not_read', missing: ['statementWeekEnding'] },
    });
  });

  test('a miles mismatch only warns: Verified, amber', () => {
    const e = golden0814({ totalMiles: 7819 });
    expect(buildPrimeStatementCheck(e)!.gatePassed).toBe(true);
    expect(buildReviewVerdict(e, { saveBlocked: false })).toMatchObject({ tone: 'amber', reason: { kind: 'statement_warning', check: { id: 'milesMatch' } } });
  });
});

// =====================================================================
// ITEM 7 — the verdict
// =====================================================================
describe('review verdict (item 7)', () => {
  const CODES = PRIME_CODES.map((c) => ({
    carrier: c.carrier,
    code: c.code as string,
    subCode: c.sub_code as string | null,
    label: c.label as string,
    description: null,
    category: c.category as string | null,
    isDeductible: c.is_deductible as boolean | null,
    incomeOrChargeback: null,
    notes: null,
  }));

  test("green: Verified by Prime's statement — profit 4,987.74, deposited 3,072.57", () => {
    expect(buildReviewVerdict(golden0814(), { saveBlocked: false })).toEqual({ tone: 'green', kind: 'verified', profit: KEY.profit, deposit: KEY.deposit });
  });

  test('no statement, printed totals match: green "Totals match. Profit estimated from line items" — never Verified', () => {
    // No deposit line either: without the statement the balance forward is
    // not read, so a printed deposit of 3,072.57 could not tie to net due
    // 4,276.08 (that week is red — next test's sibling below).
    const verdict = buildReviewVerdict(golden0814({ operating: undefined, depositAmount: undefined }), { saveBlocked: false, carrierCodes: CODES });
    expect(verdict).toEqual({ tone: 'green', kind: 'totals_match', profit: r2(KEY.profit + KEY.interestExpense) });
  });

  test('no statement but a deposit line: the balance forward is unknown, the deposit does not tie -> red', () => {
    const e = golden0814({ operating: undefined });
    expect(buildReviewVerdict(e, { saveBlocked: isSaveBlocked(e) })).toMatchObject({ tone: 'red', reason: { kind: 'line_check_failed', issue: { type: 'depositMismatch' } } });
  });

  test('no statement, a line total that does not add up: red, the line check in one sentence', () => {
    const e = golden0814({ operating: undefined, totalDeductions: 5306.54 });
    expect(isSaveBlocked(e)).toBe(true);
    expect(buildReviewVerdict(e, { saveBlocked: true })).toMatchObject({ tone: 'red', reason: { kind: 'line_check_failed', issue: { type: 'deductionsMismatch' } } });
  });

  test('a reading from the older prompt (no printed labels / no balance forward field) is "read with an older version"', () => {
    expect(isOlderReading(golden0814({ totalLabels: { grossRevenue: 'TOTAL REV' } }))).toBe(false);
    expect(isOlderReading(golden0814())).toBe(true); // no totalLabels
    expect(isOlderReading(withStatement({ priorWeekBalanceForward: undefined }, { totalLabels: {} }))).toBe(true);
  });
});

// =====================================================================
describe('printed dates (owner decision 2026-10-29): a 2014 or 2021 date never reaches the database', () => {
  test('the real week saves with week_ending 2026-08-14 and records what was printed', async () => {
    const rows = await importWeek(golden0814());
    expect(rows.settlements[0].week_ending).toBe('2026-08-14');
    expect(rows.settlements[0].statement?.dates).toMatchObject({
      settlementDateRaw: '26/08/14',
      printDateRaw: '8/13/26',
      statementWeekEndingRaw: '26/08/14',
      printedWeekEnding: '2026-08-14',
      format: 'YMD',
    });
  });

  test('the model read "26/08/14" as 2014-08-26: the app parses the printed text and saves 2026-08-14', async () => {
    const misread = golden0814({ weekEnding: '2014-08-26', operating: { ...STATEMENT, weekEnding: '2014-08-26' } });
    const rows = await importWeek(sanitizeExtractionDates(misread, new Date('2026-10-29T12:00:00Z')));
    expect(rows.settlements.map((s) => s.week_ending)).toEqual(['2026-08-14']);
  });

  test.each(['2014-08-26', '2021-08-26'])('an unconfirmed %s is refused before anything is written', async (bad) => {
    const older = golden0814({ weekEnding: bad, settlementDateRaw: undefined, printDateRaw: undefined, statementWeekEndingRaw: undefined });
    await expect(importWeek(older)).rejects.toThrow(/confirm the week ending/);
    expect((mockClient.__store as Record<string, unknown[]>).settlements ?? []).toEqual([]);
    expect((mockClient.__store as Record<string, unknown[]>).documents ?? []).toEqual([]);
  });

  test('a 2014 date is refused even when "confirmed"; a confirmed 2026 date of an older reading saves', async () => {
    const confirmed14 = golden0814({
      weekEnding: '2014-08-26',
      settlementDateRaw: undefined,
      dateConfirmed: { weekEnding: '2014-08-26', by: 'user' },
    });
    await expect(importWeek(confirmed14)).rejects.toThrow(/confirm the week ending/);
    const confirmed26 = golden0814({
      settlementDateRaw: undefined,
      printDateRaw: undefined,
      statementWeekEndingRaw: undefined,
      dateConfirmed: { weekEnding: '2026-08-14', by: 'user' },
    });
    expect((await importWeek(confirmed26)).settlements.map((s) => s.week_ending)).toEqual(['2026-08-14']);
  });
});

// Batch 0b.2 (2026-10-30): escrow / advance repayment / meals are listed
// for reference in the withheld and combined scopes, never deductible.
describe('accountant package — withheld lines are never deductible (0b.2)', () => {
  it('golden W/E 8/14', async () => {
    const { buildLineItems, buildScheduleCTotals, buildNotDeductibleReference } = await import('@/src/stats/accountantPackage');
    const rows = await importWeek(golden0814());
    for (const scope of ['withheld', 'combined'] as const) {
      const items = buildLineItems(rows.deductions, rows.fuel, [], [], 2026, 8, scope);
      const deductible = buildScheduleCTotals(items, []).reduce((sum, c) => sum + c.amount, 0);
      const reference = buildNotDeductibleReference(items);
      expect(reference.items.every((li) => ['Escrow & Deposits', 'Advance Repayment', 'Meals (per diem covered)'].includes(li.category))).toBe(true);
      expect(reference.items.some((li) => li.category === 'Escrow & Deposits')).toBe(true);
      // Before the fix the deductible total was 4,100.66.
      expect(r2(deductible)).toBe(3388.41);
      expect(r2(reference.total)).toBe(712.25);
    }
  });
});

// BATCH C (owner decision 2026-10-30): review this week + certify, miles.
import { buildWeekCheckItems, weekReviewState, CERTIFICATION_TEXT_VERSION } from '@/src/import/weekReview';
import { acknowledgeWeekItem, certifyWeek, saveManualMilesSplit } from '@/src/data/weekReviewMutations';

describe('batch C item 5 — the Verified week raises only what truly needs a look', () => {
  const ctx = { documentLowConfidence: true, today: '2026-10-30' };

  it('golden W/E 8/14: nothing to check (the multi-page "low confidence" alone is not an item), ready to certify', async () => {
    const s = (await importWeek(golden0814())).settlements[0];
    expect(settlementVerification(s)).toBe('verified_prime');
    expect(buildWeekCheckItems(s, ctx)).toEqual([]);
    expect(weekReviewState(s, ctx).canCertify).toBe(true);
  });

  it('root cause fixed: the AI left totalMiles 0 -> the statement MILES (3,316) is saved, 7 per diem days, no "miles missing"', async () => {
    const s = (await importWeek(golden0814({ totalMiles: 0 }))).settlements[0];
    expect(s.miles).toBe(KEY.miles);
    expect(s.per_diem_days).toBe(7);
    expect(buildWeekCheckItems(s, ctx).map((i) => i.kind)).not.toContain('miles_missing');
  });

  it('an AI header miles that differs (a lifetime figure) is not an item on a Verified week; the statement figure is saved', async () => {
    const s = (await importWeek(golden0814({ totalMiles: 412345 }))).settlements[0];
    expect(s.miles).toBe(KEY.miles);
    expect(buildWeekCheckItems(s, ctx)).toEqual([]);
  });

  it('without the statement page (printed totals match) a low-confidence read is the one item', async () => {
    const s = (await importWeek(golden0814({ operating: undefined }))).settlements[0];
    expect(settlementVerification(s)).toBe('totals_match');
    expect(buildWeekCheckItems(s, ctx).map((i) => i.kind)).toEqual(['low_confidence']);
  });

  it('an Unverified week raises "unverified" once — never a second item for the same low-confidence read', () => {
    const s = { id: 's1', week_ending: '2026-08-14', carrier: 'Acme', gross: 5000, miles: 2000, statement: null };
    expect(buildWeekCheckItems(s, ctx).map((i) => i.kind)).toEqual(['unverified']);
    expect(buildWeekCheckItems({ ...s, miles: 0 }, ctx).map((i) => i.kind)).toEqual(['miles_missing', 'unverified']);
  });
});

describe('batch C item 5 — certify, re-certify, and no certification survives an edit', () => {
  const certified = () => (mockClient.__store as Record<string, Settlement[]>).settlements[0];

  it('Certify records time, text version and app version, and marks the document reviewed', async () => {
    const s = (await importWeek(golden0814())).settlements[0];
    await certifyWeek({ id: s.id, document_id: s.document_id }, '1.0.0+abc1234', '2026-10-30T15:00:00.000Z');
    expect(certified()).toMatchObject({
      certified_at: '2026-10-30T15:00:00.000Z',
      certification_text_version: CERTIFICATION_TEXT_VERSION,
      certification_app_version: '1.0.0+abc1234',
    });
    const doc = (mockClient.__store as Record<string, { id: string; reviewed_at?: string }[]>).documents.find((d) => d.id === s.document_id);
    expect(doc?.reviewed_at).toBe('2026-10-30T15:00:00.000Z');
  });

  it('every kind of later edit clears it; re-certify works each time', async () => {
    const s = (await importWeek(golden0814())).settlements[0];
    const certify = () => certifyWeek({ id: s.id, document_id: null }, '1.0.0', '2026-10-30T15:00:00.000Z');
    const client = mockClient;

    // (1) an edit of the week's own row
    await certify();
    await client.from('settlements').update({ per_diem_days: 6 }).eq('id', s.id);
    expect(certified().certified_at).toBeNull();

    // (2) a row added to the week
    await certify();
    expect(certified().certified_at).toBe('2026-10-30T15:00:00.000Z');
    await client.from('deductions').insert({ user_id: USER_ID, settlement_id: s.id, amount: 10, ded_date: WEEK_ENDING });
    expect(certified().certified_at).toBeNull();

    // (3) a row of the week deleted
    await certify();
    const anyLoad = (client.__store as Record<string, { id: string; settlement_id: string }[]>).loads.find((l) => l.settlement_id === s.id)!;
    await client.from('loads').delete().eq('id', anyLoad.id);
    expect(certified().certified_at).toBeNull();

    // (4) a manual loaded/empty correction is an edit too
    await certify();
    await saveManualMilesSplit(s.id, 2700, 616);
    expect(certified().certified_at).toBeNull();

    // (5) a "Looks right" mark is not an edit and survives certifying
    await acknowledgeWeekItem({ id: s.id, review_acknowledged: null }, 'unverified');
    await certify();
    expect(certified().review_acknowledged).toEqual(['unverified']);
    expect(certified().certified_at).toBe('2026-10-30T15:00:00.000Z');
  });

  it('a re-import clears the certification but keeps the manual loaded/empty split', async () => {
    const s = (await importWeek(golden0814())).settlements[0];
    await saveManualMilesSplit(s.id, 2700, 616);
    await certifyWeek({ id: s.id, document_id: null }, '1.0.0', '2026-10-30T15:00:00.000Z');
    await saveExtraction({
      importDate: '2026-10-30',
      extraction: golden0814(),
      userId: USER_ID,
      truckId: TRUCK_ID,
      driverId: null,
      driverShareAmount: null,
      fileUri: null,
      fileExt: 'pdf',
      mediaType: 'application/pdf',
      createContribution: false,
    });
    expect(certified()).toMatchObject({ certified_at: null, loaded_miles: 2700, empty_miles: 616, miles_split_source: 'manual' });
  });
});

describe('batch C item 6 — Home miles: one source, identical on every screen', () => {
  it('golden W/E 8/14: 2,739 / 577 / 3,316 = 17.4%, stored split, KPI = per-week list, fleet = truck scope', async () => {
    const rows = await importWeek(golden0814());
    expect(rows.settlements[0]).toMatchObject({ loaded_miles: 2739, empty_miles: 577, miles_split_source: 'loads', miles_split_label: 'EMPTY' });
    const kpi = weekKpi(rows);
    expect([kpi.miles.loaded, kpi.miles.empty, kpi.miles.total]).toEqual([2739, 577, 3316]);
    expect(Math.round(kpi.miles.deadheadPct! * 1000) / 10).toBe(17.4);
    expect(kpi.miles.weeksWithoutBreakdown).toBe(0);
    expect(kpi.miles.weeks).toHaveLength(1);
    expect(kpi.miles.weeks[0]).toMatchObject({ loadedMiles: 2739, emptyMiles: 577, totalMiles: 3316 });
    expect(weekKpi(rows, null).miles).toEqual(kpi.miles);
  });

  it('profit, CPM, RPM and PPM are unchanged by the stored split', async () => {
    const rows = await importWeek(golden0814());
    const withSplit = weekKpi(rows);
    const without = weekKpi({
      ...rows,
      settlements: rows.settlements.map((x) => ({ ...x, loaded_miles: null, empty_miles: null, miles_split_source: null, miles_split_label: null })),
    });
    expect([withSplit.net, withSplit.cpm, withSplit.rpm, withSplit.ppm, withSplit.miles.total]).toEqual([
      without.net,
      without.cpm,
      without.rpm,
      without.ppm,
      without.miles.total,
    ]);
  });
});
