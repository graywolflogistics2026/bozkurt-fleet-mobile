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
import { readPrimeYtdSnapshotFromParsedJson } from '@/src/import/primeOperatingStatement';

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

  test('deposit is read: 3,072.57 from the printed DIRECT DEPOSIT, never computed', () => {
    expect(rows.settlements[0].statement?.printed).toMatchObject({ deposit: KEY.deposit, depositSource: 'direct_deposit', balanceForward: KEY.balanceForward, interestNet: -KEY.interestExpense });
    expect(settlementDeposit(rows.settlements[0])).toEqual({ deposited: KEY.deposit, owedToCarrier: 0, source: 'direct_deposit' });
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

  test('line items vs statement: 61.66 apart = the meal line counted as an expense (62.25) − interest only on the statement (0.59)', () => {
    // Prime books the fuel card under WIRE CHARGE and splits the weight
    // tickets, so lines reconcile at total level only. REPORTED TO THE
    // OWNER 2026-10-17, NOT FIXED (classification needs approval): Prime
    // codes match on the description text only (carrierCodes.ts
    // findCarrierCodeMatch), so the PO line "NORTH STAR GRILL, MO" is not
    // recognised as a meal on the line route. Profit is unaffected — this
    // week counts from the statement.
    const k = weekKpi(rows);
    expect(k.bridge.crossChecks).toEqual([
      { settlementId: rows.settlements[0].id, weekEnding: WEEK_ENDING, lineExpenses: expect.closeTo(2988.02, 2), statementExpenses: expect.closeTo(KEY.expenses, 2), difference: r2(62.25 - KEY.interestExpense) },
    ]);
    expect(rows.deductions.find((d) => d.description === 'NORTH STAR GRILL, MO')!.category).not.toBe('Meals (per diem covered)');
    expect(r2(k.net)).toBe(KEY.profit);
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

  test('the statement week ending must be the settlement week ending; "26/08/14" read as 2014-08-26 is the same week', () => {
    expect(failedChecks(withStatement({ weekEnding: '2026-08-21' }))).toEqual(['statementWeekEnding']);
    expect(failedChecks(withStatement({ weekEnding: '2014-08-26' }))).toEqual([]);
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
