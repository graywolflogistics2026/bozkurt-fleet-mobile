// GOLDEN SETTLEMENT — the permanent oracle for the profit engine and the
// Prime operating-statement reconciliation (owner decision 2026-10-13,
// docs/decisions/golden-settlement.md).
//
// Source: GRWLLG-OY-PrimeInc6.pdf — Prime Inc, unit 283940, week ending
// 2026-08-21, 8 pages, verified by hand against Prime's printed totals
// and its Statement of Income and Expense (pages 5-6). Every number below
// is from that document; none may change without a fresh hand check.
//
// Every test runs the REAL saveExtraction() into the in-memory Supabase,
// then reads the saved rows through the SAME functions each screen uses:
//   Home hero / Net Profit tile / per-mile trio  -> buildPeriodScopedCpm()
//   Home chart, Scorecard trend, AI Coach week   -> buildWeeklyTrueProfitTrend()
//   Scorecard, AI Coach CPM, Settlements (Prime) -> computeKpis()
//   Profit Analysis (+ AI Coach rollup)          -> buildProfitAnalysis()
//   Per-Truck Profitability, Home per-truck card -> buildTruckComparison()
//   Profit bridge sheet                          -> computeKpis().bridge
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { owedToCarrier, printedTotalCashFlow } from '@/src/stats/owedToCarrier';
import type { Extraction, ExtractedFuel, ExtractedSettlementDeduction } from '@/src/import/types';
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
import { buildWeeklyTrueProfitTrend, calcTrueProfit, reducesTrueProfit } from '@/src/stats/trueProfit';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { buildTruckComparison, type ComparisonTruck } from '@/src/stats/truckComparison';
import { checkSettlementReconciliation } from '@/src/import/settlementReconciliation';
import { buildPrimeStatementCheck, settlementDeposit, settlementVerification } from '@/src/import/settlementStatement';
import { buildPrimeGroupChecks } from '@/src/import/primeLineGroups';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { resolveHeroPeriodDateWindow } from '@/src/stats/heroPeriodWindow';
import { truckHomeProfits } from '@/src/stats/truckHomeProfit';
import { isSaveBlocked, saveGateFailures } from '@/src/import/reviewVerdict';

// ---------------------------------------------------------------------
// ANSWER KEY (owner, independently verified)
// ---------------------------------------------------------------------
const KEY = {
  revenue: 4783.75, // OWNER REVENUE column
  reimbursements: 312.8,
  deductionsPrinted: 3212.19,
  nonExpenses: 650, // warranty advance 500 + personal-items advance 50 + performance bond 100
  expenses: 2249.39,
  profit: 2534.36,
  netDue: 1884.36,
  deposit: 1884.73,
  interest: 0.37,
  miles: 2327,
  loadedMiles: 2081,
  emptyMiles: 246,
  rpm: 2.06,
  cpm: 0.97,
  ppm: 1.09,
};

const USER_ID = 'user-1';
const TRUCK_ID = 'truck-283940';
const WEEK_ENDING = '2026-08-21';
const WEEK_START = '2026-08-15';
const NOW = new Date('2026-08-22T12:00:00');

// ---------------------------------------------------------------------
// THE STATEMENT (pages 1-2 revenue/reimbursement/deduction sections,
// pages 4-6 recap + operating statement). Pages 7 (EZ-Pass bill) and 8
// (delivery receipt, customer total 3,414.48) are attachments: no lines.
// ---------------------------------------------------------------------
const REVENUE_ITEMS = [
  { desc: 'EZ PASS TOLL', order: '', amount: 0.07 },
  { desc: 'SRV/S.050/M 0327', order: 'I082126', amount: 16.35 },
  { desc: 'SFY/S.050/M 0327', order: 'I082126', amount: 16.35 },
  { desc: 'EP OTHER — ADJ FOR LAYOVER W/ REEFER/TRLR 8/13 WBDAL REPAIRS', order: '4931691', amount: 175 },
  { desc: 'FUEL SURCG FLAT', order: '4931691', amount: 624.52 },
  { desc: 'TRIP REVENUE', order: '4931691', amount: 1505.71 },
  { desc: 'Reefer Fuel Surc', order: '4942415', amount: 20.82 },
  { desc: 'FUEL SURCG FLAT', order: '4942415', amount: 585.52 },
  { desc: 'TRIP REVENUE', order: '4942415', amount: 1839.41 },
];
const REIMBURSEMENT_ITEMS = [
  { code: 'PR', desc: 'WIE14MB LD', ref: '', amount: 1 },
  { desc: 'REEFER FUEL', ref: 'A705706', amount: 10.37 },
  { desc: 'REEFER FUEL', ref: 'A705768', amount: 32.43 },
  { desc: 'REEFER FUEL', ref: 'A705795', amount: 76.04 },
  { desc: 'REEFER FUEL', ref: 'A705901', amount: 31.91 },
  { desc: 'WASH INTERIOR', ref: '6586921', amount: 52 },
  { desc: 'REEFER FUEL', ref: 'A705987', amount: 18.13 },
  { desc: 'REEFER FUEL', ref: 'A705999', amount: 47.42 },
  { desc: 'WASH INTERIOR', ref: '6628768', amount: 43.5 },
];
const D = (code: string, desc: string, amount: number | string): ExtractedSettlementDeduction => ({ code, desc, amount: amount as number });
// Non-fuel deduction lines. Page 1 carries the FIRST line (AS 23.50), the
// rest are on page 2 (trap 3).
const NON_FUEL_LINES = [
  D('AS', 'ACCOUNTING SERV', 23.5),
  D('AS', 'ACCOUNTING SERV 2026 TRUST SERVICE BOZKA', 65.87),
  D('EZ', 'EZ FAST LN TOLL0001 thru 08/12', 0.25),
  D('FC', 'FUEL CARD CHARGE', 1),
  D('IM', 'IMAGE TRIPS', 5),
  D('LP', 'LICENSE/PERMITS', 100),
  D('MT', 'MAYFR BT/DH INS', 5.98),
  D('MY', 'MAYFAIR PHY DAM', 30.43),
  D('OW', 'OWNER OCCUP ACC', 29.99),
  D('PB', 'PERFORMNCE BOND', 100),
  D('QR', 'QUAL/GEO RENTAL', 18.34),
  D('WA', 'ADVANCE EXT WARRANTY PURCHASE', 500),
  D('WA', 'ADVANCE GLOVES, FOLDER, NAIL CLIPPER, STAMP, SHAVING CREAM, LOCKS, RAZOR', 50),
  D('SF', 'FUEL TAX CHARGES', 24.02),
  D('SF', 'FUEL TAX CHARGES', 22.52),
  D('WI', 'WASH INTERIOR', 52),
  D('WI', 'WASH INTERIOR', 43.5),
  D('WA', 'ADV FOR WEIGHT TICKETS', 16.25),
  D('UD', 'TRAC FUEL DSCNT', -184.85),
  D('RD', 'REEF FUEL DSCNT', -17.92),
  D('ED', 'DEF DISCOUNT', -29.15),
];
// Fuel lines: [code, description, date, charged, FUEL DISCNT column]. The
// discount column is informational — the UD/RD/ED credits above apply it
// (trap 2). Several are dated 8/13-8/14, BEFORE this week's 8/15 start.
type FuelLine = [string, string, string, number, number];
const REEFER: FuelLine[] = [
  ['RF', 'REEFER FUEL 011.1 GALS.', '2026-08-13', 61.15, 3.78],
  ['RF', 'REEFER FUEL 009.0 GALS.', '2026-08-14', 48.61, 0.45],
  ['RF', 'REEFER FUEL 003.5 GALS.', '2026-08-16', 20.03, 1.9],
  ['RF', 'REEFER FUEL 009.0 GALS.', '2026-08-16', 50.14, 2.72],
  ['RF', 'REEFER FUEL 004.6 GALS.', '2026-08-17', 26.06, 3.21],
  ['RF', 'REEFER FUEL 010.1 GALS.', '2026-08-19', 56.54, 5.86],
];
const DEF: FuelLine[] = [
  ['UE', 'TRACTOR DEF', '2026-08-13', 3.22, 1.01],
  ['UE', 'TRACTOR DEF', '2026-08-13', 34.63, 9.56],
  ['UE', 'TRACTOR DEF', '2026-08-15', 24.6, 6.92],
  ['UE', 'TRACTOR DEF', '2026-08-17', 32.66, 11.66],
];
const TRACTOR: FuelLine[] = [
  ['UF', 'TRACTOR FUEL 010.9 GALS.', '2026-08-13', 60.44, 7.3],
  ['UF', 'TRACTOR FUEL 057.6 GALS.', '2026-08-13', 316.62, 19.61],
  ['UF', 'TRACTOR FUEL 022.2 GALS.', '2026-08-14', 121.28, 1.11],
  ['UF', 'TRACTOR FUEL 149.1 GALS.', '2026-08-15', 850, 83.54],
  ['UF', 'TRACTOR FUEL 011.5 GALS.', '2026-08-15', 65.53, 0],
  ['UF', 'TRACTOR FUEL 105.0 GALS.', '2026-08-17', 583.95, 73.29],
];
const asLine = ([code, desc, , amount]: FuelLine) => D(code, desc, amount);
const asFuel = ([, , date, amount, discount]: FuelLine): ExtractedFuel => ({ date, amount, discount });

// Prime's Statement of Income and Expense, WEEKS column (pages 5-6),
// every line SIGNED AS PRINTED (trailing minus = negative).
const STATEMENT_LINES = [
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
  ['fixed', 'PHYSICAL DAMAGE INSURANCE', -30.43],
  ['fixed', 'BT/DH INSURANCE', -5.98],
  ['fixed', 'LICENSE AND PERMITS', -100],
  ['fixed', 'STATEMENT PREPARATION', -89.37],
  ['fixed', 'OPERATOR OCCUP ACC', -29.99],
  ['other', 'ACCRUAL PERFORMANCE BOND', -100],
  ['other', 'INTEREST INCOME FROM DEPOST', 0.37],
].map(([section, label, amount]) => ({ section: section as string, label: label as string, amount: amount as number }));

const STATEMENT = {
  lines: STATEMENT_LINES,
  weekMiles: 2327,
  weekTotalFreightRevenue: 3345.12,
  weekTotalOtherRevenue: 1438.63,
  weekTotalRevenue: 4783.75,
  weekTotalFuelOilTax: -1953.78,
  weekTotalMiscellaneous: -589.84,
  weekTotalVariableCosts: -2543.62,
  weekTotalFixedCost: -255.77,
  weekTotalOtherIncomeAndExpense: -99.63,
  weekTotalOperatingExpenses: -2899.02,
  weekTotalStatement: 1884.73,
  // TOTAL CASH FLOW as printed (added 2026-10-31, batch D2 owed check).
  weekTotalCashFlow: 1884.73,
  settlementToOperator: 1884.73,
  directDeposit: 1884.73,
  // The statement page header's week ending. Added 2026-10-17: the gate
  // (owner decision, item 6) requires it; the new prompt reads it.
  weekEnding: WEEK_ENDING,
  ytdTotalRevenue: 24425.98,
  ytdMiles: 10146,
  ytdTotalStatement: 8099.66,
  weeksInService: 5,
};

// Where the extraction put the fuel: in BOTH the deduction lines and the
// fuel lists, ONLY in the fuel lists, or MIXED (tractor fuel in both,
// reefer fuel and DEF only in the fuel lists).
type Shape = 'both' | 'fuelListOnly' | 'mixed';

function goldenExtraction(shape: Shape, overrides: Partial<NonNullable<Extraction['settlement']>> = {}): Extraction {
  const fuelLinesInDeductions =
    shape === 'both' ? [...REEFER, ...DEF, ...TRACTOR] : shape === 'mixed' ? TRACTOR : [];
  return {
    docType: 'settlement',
    confidence: 'high',
    settlement: {
      weekEnding: WEEK_ENDING,
      printDate: '2026-08-20',
      // Printed on the real PDF: SETTLEMENT DATE 26/08/21, print DATE
      // 8/20/26, statement WEEK ENDING 26/08/21.
      settlementDateRaw: '26/08/21',
      printDateRaw: '8/20/26',
      statementWeekEndingRaw: '26/08/21',
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
      loads: [
        { order: '4931691', from: 'Killeen TX', to: 'Monroeville IN', loadedMiles: 1055, emptyMiles: 146, revenue: 1505.71 },
        { order: '4942415', from: 'Monroeville IN', to: 'Houston TX', loadedMiles: 1026, emptyMiles: 100, revenue: 1839.41 },
      ],
      tractorFuel: [...TRACTOR, ...DEF].map(asFuel),
      reeferFuel: REEFER.map(asFuel),
      deductions: [...NON_FUEL_LINES, ...fuelLinesInDeductions.map(asLine)],
      // Page 4 recap: DIRECT DEPOSIT TO BANK — the amount only.
      depositAmount: KEY.deposit,
      ...overrides,
    },
  };
}

// The Prime codes this statement uses, exactly as docs/CARRIER_CODES.md /
// carrier_code_maps (§52) seed them.
const PRIME_CODES = [
  ['AS', 'MISC 16', 'ACCOUNTING SERVICE', 'Legal & Professional Services', true],
  ['EZ', null, 'EZ FAST LN TOLL', 'Tolls & Scales', true],
  ['FC', 'MISC 15', 'FUEL CARD CHG', 'Bank & Merchant Fees', true],
  ['IM', 'FDEX 02', 'IMAGE TRIPS', 'ELD & Communications', true],
  ['LP', 'PRMT 01', 'LICENSE/PERMITS', 'Permits, Licenses & Road Taxes', true],
  ['OW', null, 'OWNER OCCUP ACC', 'Insurance—Health', true],
  ['PB', null, 'P/B ADJUSTMENT', 'Escrow & Deposits', false],
  ['QR', null, 'QUALCOMM RENTAL', 'ELD & Communications', true],
  ['RD', null, 'REEF FUEL DSCNT', null, null],
  ['RF', 'FUEL 02', 'REEFER FUEL', 'Fuel & DEF', true],
  ['UD', null, 'TRAC FUEL DSCNT', null, null],
  ['UE', 'FUEL 03', 'TRACTOR DEF', 'Fuel & DEF', true],
  ['UF', 'FUEL 01', 'TRACTOR FUEL', 'Fuel & DEF', true],
  ['WA', 'ADV 01', 'ADVANCE', 'Advance Repayment', false],
  ['WI', 'WASH 02', 'WASH INTERIOR', 'Truck Wash & Detailing', true],
  // Matches "ADV FOR WEIGHT TICKETS" by its label — without it the generic
  // classifier reads any "ADV" as an advance repayment (trap 5).
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

type Rows = {
  settlements: Settlement[];
  loads: Load[];
  deductions: Deduction[];
  fuel: FuelPurchase[];
  reimbursements: Reimbursement[];
};

async function importGolden(extraction: Extraction): Promise<Rows> {
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

const NO_COST_BASIS: ComparisonTruck = {
  id: TRUCK_ID,
  unit_number: '283940',
  cost_basis_ownership_mode: null,
  purchase_price: null,
  cost_basis_loan_monthly_payment: null,
  cost_basis_paid_spread_months: null,
  cost_basis_warranty_cost: null,
  cost_basis_warranty_term_months: null,
};
// $2,600/month truck loan -> $600/week fixed-cost estimate.
const WITH_COST_BASIS: ComparisonTruck = { ...NO_COST_BASIS, cost_basis_ownership_mode: 'loan', cost_basis_loan_monthly_payment: 2600 };
const WEEKLY_ESTIMATE = 600;

function weekKpi(rows: Rows, truck: ComparisonTruck = NO_COST_BASIS, truckScope: string | null = TRUCK_ID): KpiResult {
  return computeKpis({
    trucks: [truck],
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

// route 'statement': the week's reimbursements are inside Prime's own
// figures (REEFER FUEL 46.23 is already net), so the line-level
// reimbursement total is 0 — the same profit either way.
function expectAnswerKey(k: KpiResult, route: 'line' | 'statement' = 'line') {
  expect(r2(k.gross)).toBe(KEY.revenue);
  expect(r2(k.reimbursementsTotal)).toBe(route === 'line' ? KEY.reimbursements : 0);
  expect(r2(k.expenses.total)).toBe(KEY.expenses);
  expect(r2(k.net)).toBe(KEY.profit);
  expect(k.miles.total).toBe(KEY.miles);
  expect(r2(k.rpm)).toBe(KEY.rpm);
  expect(r2(k.cpm)).toBe(KEY.cpm);
  expect(r2(k.ppm)).toBe(KEY.ppm);
  expect(k.ppm!).toBeCloseTo(k.rpm! - k.cpm!, 10);
}

// =====================================================================
describe.each<Shape>(['both', 'fuelListOnly', 'mixed'])('golden settlement, fuel shape "%s" — every screen shows the answer key', (shape) => {
  let rows: Rows;
  beforeAll(async () => {
    rows = await importGolden(goldenExtraction(shape));
  });

  test('the import checks pass on the real statement', () => {
    expect(checkSettlementReconciliation(goldenExtraction(shape))).toEqual({ ok: true, issues: [] });
    // The LINE route: no statement page extracted, so the Prime route is never selected.
    expect(buildPrimeStatementCheck(goldenExtraction(shape))).toBeNull();
    expect(settlementVerification(rows.settlements[0])).toBe('totals_match');
  });

  test('saved rows: one settlement, 2 loads, 16 fuel rows, 9 reimbursements (312.80)', () => {
    expect(rows.settlements).toHaveLength(1);
    expect(rows.settlements[0].gross).toBe(KEY.revenue);
    expect(rows.settlements[0].net).toBe(KEY.netDue);
    expect(rows.settlements[0].miles).toBe(KEY.miles);
    expect(rows.loads).toHaveLength(2);
    expect(rows.fuel).toHaveLength(16);
    expect(r2(rows.reimbursements.reduce((s, r) => s + Number(r.amount), 0))).toBe(KEY.reimbursements);
  });

  test('computeKpis() (Scorecard, AI Coach CPM) — the week, truck scope and All Trucks', () => {
    expectAnswerKey(weekKpi(rows));
    expectAnswerKey(weekKpi(rows, NO_COST_BASIS, null));
    expect(weekKpi(rows).miles.loaded).toBe(KEY.loadedMiles);
    expect(weekKpi(rows).miles.empty).toBe(KEY.emptyMiles);
    // Batch C item 6: Home's Miles tiles — 2,081 / 246 / 2,327 = 10.6%.
    expect(weekKpi(rows).miles.total).toBe(KEY.miles);
    expect(Math.round(weekKpi(rows).miles.deadheadPct! * 1000) / 10).toBe(10.6);
    expect(weekKpi(rows).miles.weeksWithoutBreakdown).toBe(0);
  });

  test('computeKpis() all-time (Scorecard / AI Coach window: null) — same numbers', () => {
    const k = computeKpis({
      trucks: [NO_COST_BASIS],
      settlements: rows.settlements,
      loads: rows.loads,
      deductions: rows.deductions,
      fuelPurchases: rows.fuel,
      maintenanceRecords: [],
      tolls: [],
      reimbursements: rows.reimbursements,
      truckScope: TRUCK_ID,
      window: null,
    });
    expectAnswerKey(k);
  });

  test('Home — hero "This Week\'s Profit", Net Profit tile and per-mile trio (buildPeriodScopedCpm "thisWeek")', () => {
    for (const scope of [TRUCK_ID, null]) {
      const home = buildPeriodScopedCpm(
        'thisWeek',
        [WEEK_ENDING],
        [NO_COST_BASIS],
        rows.settlements,
        rows.loads,
        rows.deductions,
        rows.fuel,
        [],
        [],
        rows.reimbursements,
        scope,
        null,
        NOW
      );
      expectAnswerKey(home.kpi!);
      expect(r2(home.cpm!.revenuePerMile)).toBe(KEY.rpm);
      expect(r2(home.cpm!.costPerMile)).toBe(KEY.cpm);
      expect(r2(home.cpm!.profitPerMile)).toBe(KEY.ppm);
    }
  });

  test('weekly trend (Home chart, Scorecard trend, AI Coach latest week, goal alerts)', () => {
    const trend = buildWeeklyTrueProfitTrend(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements);
    expect(trend).toHaveLength(1);
    expect(r2(trend[0].gross)).toBe(KEY.revenue);
    expect(r2(trend[0].net)).toBe(KEY.profit);
  });

  test('Profit Analysis (and the AI Coach rollup)', () => {
    const pa = buildProfitAnalysis(rows.settlements, rows.fuel, [], rows.deductions, rows.reimbursements, WEEK_START, NOW, []);
    expect(r2(pa.revenue)).toBe(KEY.revenue);
    expect(r2(pa.reimbursementsTotal)).toBe(KEY.reimbursements);
    expect(r2(pa.totalExpenses)).toBe(KEY.expenses);
    expect(r2(pa.netIncome)).toBe(KEY.profit);
  });

  test('Per-Truck Profitability (and Home\'s per-truck card)', () => {
    const cmp = buildTruckComparison([NO_COST_BASIS], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements);
    const row = cmp.rows[0];
    expect(r2(row.netProfit)).toBe(KEY.profit);
    expect(r2(row.revenuePerMile)).toBe(KEY.rpm);
    expect(r2(row.costPerMile)).toBe(KEY.cpm);
    expect(r2(row.profitPerMile)).toBe(KEY.ppm);
  });

  test('calcTrueProfit()', () => {
    expect(r2(calcTrueProfit(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements))).toBe(KEY.profit);
  });

  test('profit bridge: net due 1,884.36 + advances and escrow 650.00 = profit 2,534.36, nothing unexplained', () => {
    const b = weekKpi(rows).bridge;
    expect(r2(b.netPay)).toBe(KEY.netDue);
    expect(b.nonExpenseLines.map((l) => [l.category, l.amount])).toEqual([
      ['Escrow & Deposits', 100],
      ['Advance Repayment', 500],
      ['Advance Repayment', 50],
    ]);
    expect(r2(b.nonExpenseLines.reduce((s, l) => s + l.amount, 0))).toBe(KEY.nonExpenses);
    expect(b.outOfPocketDeductions).toBe(0);
    expect(b.standaloneFuel).toBe(0);
    expect(b.difference).toBe(0);
    expect(r2(b.profit)).toBe(KEY.profit);
    expect(b.fixedCostEstimateInCpm).toBe(0);
    // Line route starts from net due; the deposit is read, never computed.
    expect(settlementDeposit(rows.settlements[0]).deposited).toBe(KEY.deposit);
    expect(r2(KEY.deposit + KEY.nonExpenses - KEY.interest)).toBe(KEY.profit);
  });
});

// =====================================================================
describe('truck fixed-cost estimate — in CPM/PPM only, never in profit (owner decision 2026-10-13)', () => {
  let rows: Rows;
  beforeAll(async () => {
    rows = await importGolden(goldenExtraction('both'));
  });

  test('no cost basis -> CPM 0.97, profit 2,534.36', () => {
    const k = weekKpi(rows, NO_COST_BASIS);
    expect(r2(k.cpm)).toBe(KEY.cpm);
    expect(r2(k.net)).toBe(KEY.profit);
  });

  test('cost basis entered -> CPM = 0.97 + weekly estimate / 2,327; This Week\'s Profit unchanged; RPM − CPM = PPM', () => {
    const k = weekKpi(rows, WITH_COST_BASIS);
    expect(k.cpm!).toBeCloseTo(KEY.expenses / KEY.miles + WEEKLY_ESTIMATE / KEY.miles, 10);
    expect(r2(k.net)).toBe(KEY.profit);
    expect(k.ppm!).toBeCloseTo(k.rpm! - k.cpm!, 10);
    // Shown as its own note on the bridge, never a hidden subtraction.
    expect(k.bridge.fixedCostEstimateInCpm).toBeCloseTo(WEEKLY_ESTIMATE, 6);
    expect(k.bridge.difference).toBe(0);
    expect(r2(k.bridge.profit)).toBe(KEY.profit);

    const home = buildPeriodScopedCpm('thisWeek', [WEEK_ENDING], [WITH_COST_BASIS], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements, TRUCK_ID, null, NOW);
    expect(r2(home.kpi!.net)).toBe(KEY.profit);
    expect(home.cpm!.profitPerMile!).toBeCloseTo(home.cpm!.revenuePerMile! - home.cpm!.costPerMile!, 10);
  });

  test('Per-Truck Profitability DOES subtract the estimate in its own net profit (pre-existing convention, reported) — RPM − CPM = PPM still holds', () => {
    const row = buildTruckComparison([WITH_COST_BASIS], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements).rows[0];
    expect(r2(row.netProfit)).toBe(r2(KEY.profit - WEEKLY_ESTIMATE));
    expect(row.profitPerMile!).toBeCloseTo(row.revenuePerMile! - row.costPerMile!, 10);
  });
});

// =====================================================================
// THE EIGHT TRAPS — each with its own test.
// =====================================================================
describe('trap 1 — trailing-minus credits ("184.85-")', () => {
  test('text amounts with a trailing minus save as negative credits and the week still matches the key', async () => {
    const lines = goldenExtraction('both').settlement!.deductions!.map((d) =>
      d.code === 'UD' ? D('UD', d.desc!, '184.85-') : d.code === 'RD' ? D('RD', d.desc!, '17.92-') : d.code === 'ED' ? D('ED', d.desc!, '29.15-') : d
    );
    const extraction = goldenExtraction('both', { deductions: lines });
    expect(checkSettlementReconciliation(extraction).ok).toBe(true);
    const rows = await importGolden(extraction);
    expect(rows.deductions.filter((d) => ['UD', 'RD', 'ED'].includes(d.code ?? '')).map((d) => d.amount)).toEqual([-184.85, -17.92, -29.15]);
    expectAnswerKey(weekKpi(rows));
  });

  test('losing the sign is caught at import (deductions and net due no longer add up)', () => {
    const lines = goldenExtraction('both').settlement!.deductions!.map((d) =>
      ['UD', 'RD', 'ED'].includes(d.code ?? '') ? D(d.code!, d.desc!, Math.abs(Number(d.amount))) : d
    );
    const result = checkSettlementReconciliation(goldenExtraction('both', { deductions: lines }));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.type)).toEqual(['deductionsMismatch']);
  });
});

describe('trap 2 — the per-line FUEL DISCNT column is informational', () => {
  test('fuel-list rows carry the discount, but it is never subtracted on top of the UD/RD/ED credits', async () => {
    const rows = await importGolden(goldenExtraction('fuelListOnly'));
    expect(r2(rows.fuel.reduce((s, f) => s + Number(f.discount), 0))).toBe(231.92);
    // Subtracting the column too would lower profit by another 231.92.
    expectAnswerKey(weekKpi(rows));
  });
});

describe('trap 3 — the deduction section spans pages 1-2', () => {
  test('both accounting lines are saved (23.50 page 1 + 65.87 page 2 = Prime STATEMENT PREPARATION 89.37)', async () => {
    const rows = await importGolden(goldenExtraction('both'));
    const accounting = rows.deductions.filter((d) => d.code === 'AS');
    expect(accounting.map((d) => d.amount)).toEqual([23.5, 65.87]);
    expect(r2(accounting.reduce((s, d) => s + Number(d.amount), 0))).toBe(89.37);
  });

  test('dropping the page-1 line is caught at import', () => {
    const lines = goldenExtraction('both').settlement!.deductions!.filter((d) => !(d.code === 'AS' && d.amount === 23.5));
    const result = checkSettlementReconciliation(goldenExtraction('both', { deductions: lines }));
    expect(result.issues).toEqual([{ type: 'deductionsMismatch', stated: 3212.19, summed: expect.closeTo(3188.69, 2) }]);
  });
});

describe('trap 4 — a reimbursement offsets its own expense', () => {
  test('reefer fuel 262.53 − 216.30 = 46.23 (Prime prints REEFER FUEL 46.23-); wash interior 95.50 − 95.50 = 0', async () => {
    const rows = await importGolden(goldenExtraction('both'));
    const sum = <T>(xs: T[], f: (x: T) => unknown) => r2(xs.reduce((s, x) => s + Number(f(x)), 0))!;
    const reeferDeducted = sum(rows.deductions.filter((d) => d.code === 'RF'), (d) => d.amount);
    const reeferReimbursed = sum(rows.reimbursements.filter((r) => r.description === 'REEFER FUEL'), (r) => r.amount);
    expect(reeferDeducted).toBe(262.53);
    expect(reeferReimbursed).toBe(216.3);
    expect(r2(reeferDeducted - reeferReimbursed)).toBe(46.23);
    const washDeducted = sum(rows.deductions.filter((d) => d.code === 'WI'), (d) => d.amount);
    const washReimbursed = sum(rows.reimbursements.filter((r) => r.description === 'WASH INTERIOR'), (r) => r.amount);
    expect(r2(washDeducted - washReimbursed)).toBe(0);
  });

  test('without reimbursements the week would understate profit by exactly 312.80', async () => {
    const rows = await importGolden(goldenExtraction('both'));
    const withoutOffset = weekKpi({ ...rows, reimbursements: [] });
    expect(r2(withoutOffset.net)).toBe(r2(KEY.profit - KEY.reimbursements));
    // RPM stays on revenue — reimbursements are never counted as revenue.
    expect(r2(withoutOffset.rpm)).toBe(KEY.rpm);
  });
});

describe('trap 5 — "ADV FOR WEIGHT TICKETS" is a real scale expense', () => {
  test('16.25 counts; the 500 warranty advance, the 50 personal advance and the 100 bond do not', async () => {
    const rows = await importGolden(goldenExtraction('both'));
    const weight = rows.deductions.find((d) => d.description === 'ADV FOR WEIGHT TICKETS')!;
    expect(weight.amount).toBe(16.25);
    expect(weight.category).toBe('Tolls & Scales');
    expect(reducesTrueProfit(weight)).toBe(true);
    const excluded = rows.deductions.filter((d) => !reducesTrueProfit(d));
    expect(excluded.map((d) => d.amount).sort((a, b) => Number(a) - Number(b))).toEqual([50, 100, 500]);
  });
});

describe('trap 6 — revenue comes from the OWNER REVENUE column', () => {
  test('LOAD REVENUE (2,429.08 / 2,554.74) in place of OWNER REVENUE is caught at import', () => {
    const items = REVENUE_ITEMS.map((r) =>
      r.desc === 'TRIP REVENUE' ? { ...r, amount: r.amount === 1505.71 ? 2429.08 : 2554.74 } : r
    );
    const result = checkSettlementReconciliation(goldenExtraction('both', { revenueItems: items }));
    expect(result.issues.map((i) => i.type)).toEqual(['revenueLinesMismatch']);
  });

  test('a gross taken from LOAD REVENUE fails the revenue, net-due and Prime checks', () => {
    const extraction = goldenExtraction('both', { grossRevenue: 4983.82 });
    expect(checkSettlementReconciliation(extraction).issues.map((i) => i.type)).toEqual(['revenueLinesMismatch', 'netDueMismatch']);
    const check = buildPrimeStatementCheck({ ...extraction, settlement: { ...extraction.settlement!, operating: STATEMENT } })!;
    expect(check.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['grossMatches']);
  });
});

describe('trap 7 — pages 7-8 are attachments (no revenue, no expense)', () => {
  test('the delivery receipt\'s customer total 3,414.48 read as revenue is caught at import', () => {
    const items = [...REVENUE_ITEMS, { desc: 'DELIVERY RECEIPT TOTAL', order: '4942415', amount: 3414.48 }];
    expect(checkSettlementReconciliation(goldenExtraction('both', { revenueItems: items })).issues.map((i) => i.type)).toEqual([
      'revenueLinesMismatch',
    ]);
  });
});

describe('trap 8 — net amount due 1,884.36 vs direct deposit 1,884.73', () => {
  test('line route: the bridge starts from net due; the deposit 1,884.73 is read from the printed line', async () => {
    const rows = await importGolden(goldenExtraction('both'));
    expect(weekKpi(rows).bridge.netPay).toBe(KEY.netDue);
    expect(weekKpi(rows).deposits).toBe(KEY.deposit);
  });
});

describe('miles — the week, never LTD/QTD 10,146', () => {
  test('2,327 = 2,081 loaded + 246 empty; 10,146 as the week is flagged by the Prime check', () => {
    const check = buildPrimeStatementCheck(goldenExtraction('both', { totalMiles: 10146, operating: STATEMENT }))!;
    expect(check.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['milesMatch']);
  });
});

describe('reconciliation escape hatch — a null printed total never fails a check', () => {
  test('a statement that prints no totals at all passes (nothing to compare, nothing guessed)', () => {
    const extraction = goldenExtraction('both', { totalDeductions: undefined, reimbursements: undefined, grossRevenue: undefined, netPay: -5, depositAmount: undefined });
    expect(checkSettlementReconciliation(extraction)).toEqual({ ok: true, issues: [] });
  });
});

// =====================================================================
// PRIME STATEMENT AS SOURCE (owner decision 2026-10-13,
// docs/decisions/prime-statement-source.md) — the SAME golden week, now
// with Prime's Statement of Income and Expense extracted. Profit comes
// from the statement; the week's ~70 settlement-linked rows stay as
// detail and are never counted twice.
// =====================================================================
const statementExtraction = (overrides: Partial<NonNullable<Extraction['settlement']>> = {}, shape: Shape = 'both') =>
  goldenExtraction(shape, { operating: STATEMENT, ...overrides });

describe.each<Shape>(['both', 'fuelListOnly', 'mixed'])('statement route, fuel shape "%s" — same answer key on every screen', (shape) => {
  let rows: Rows;
  beforeAll(async () => {
    rows = await importGolden(statementExtraction({}, shape));
  });

  test('self-check passes; the stored week is "Verified by Prime statement"', () => {
    const check = buildPrimeStatementCheck(statementExtraction({}, shape))!;
    expect(check.checks.filter((c) => !c.passed)).toEqual([]);
    expect(check.passed).toBe(true);
    expect(rows.settlements[0].statement?.source).toBe('prime_statement');
    expect(settlementVerification(rows.settlements[0])).toBe('verified_prime');
  });

  test('computeKpis / Home / trend / Profit Analysis / Per-Truck / calcTrueProfit all give 2,534.36', () => {
    expectAnswerKey(weekKpi(rows), 'statement');
    expectAnswerKey(weekKpi(rows, NO_COST_BASIS, null), 'statement');
    const home = buildPeriodScopedCpm('thisWeek', [WEEK_ENDING], [NO_COST_BASIS], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements, TRUCK_ID, null, NOW);
    expectAnswerKey(home.kpi!, 'statement');
    const trend = buildWeeklyTrueProfitTrend(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements);
    expect(r2(trend[0].net)).toBe(KEY.profit);
    const pa = buildProfitAnalysis(rows.settlements, rows.fuel, [], rows.deductions, rows.reimbursements, WEEK_START, NOW, []);
    expect(r2(pa.netIncome)).toBe(KEY.profit);
    expect(r2(pa.statementExpenses)).toBe(KEY.expenses);
    expect(r2(pa.totalExpenses)).toBe(KEY.expenses);
    const row = buildTruckComparison([NO_COST_BASIS], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements).rows[0];
    expect(r2(row.netProfit)).toBe(KEY.profit);
    expect(r2(calcTrueProfit(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements))).toBe(KEY.profit);
  });

  test('R2: fixed = Prime\'s printed 255.77, variable 1,993.62', () => {
    const k = weekKpi(rows);
    expect(r2(k.expenses.fixed)).toBe(255.77);
    expect(r2(k.expenses.variable)).toBe(1993.62);
  });

  test('no double count: every expense is the statement\'s; the ledger adds up to the same 2,249.39', () => {
    const k = weekKpi(rows);
    expect(r2(k.statementExpenses)).toBe(KEY.expenses);
    expect(r2(k.reimbursementsTotal)).toBe(0); // linked reimbursements are detail on a statement week
    expect(k.ledger.every((r) => r.source === 'prime_statement')).toBe(true);
    const counted = k.ledger.filter((r) => r.status === 'counted').reduce((s, r) => s + r.amount, 0);
    const offset = k.ledger.filter((r) => r.status === 'offset').reduce((s, r) => s + r.amount, 0);
    expect(r2(counted - offset)).toBe(KEY.expenses);
    const excluded = k.ledger.filter((r) => r.status === 'excluded').map((r) => [r.label, r.amount, r.reason]);
    expect(excluded).toEqual([
      ['ADVANCES', 550, 'advance'],
      ['ACCRUAL PERFORMANCE BOND', 100, 'escrow'],
      ['INTEREST INCOME FROM DEPOST', 0.37, 'interest_income'],
    ]);
  });

  test('B2: the bridge starts from the actual deposit — 1,884.73 + 550.00 + 100.00 − 0.37 = 2,534.36', () => {
    const b = weekKpi(rows).bridge;
    expect(b.depositStart).toBe(KEY.deposit);
    expect(b.netPay).toBe(0);
    expect(b.statementAddBacks.map((a) => [a.label, a.amount])).toEqual([
      ['ADVANCES', 550],
      ['ACCRUAL PERFORMANCE BOND', 100],
    ]);
    expect(b.interestIncome).toBe(KEY.interest);
    expect(b.difference).toBe(0);
    expect(r2(b.profit)).toBe(KEY.profit);
    // Item 6: the week's own line items agree with the statement.
    expect(b.crossChecks).toEqual([]);
  });

  test('B1/B4: Home shows profit 2,534.36 and "Deposited to your bank" 1,884.73', () => {
    const home = buildPeriodScopedCpm('thisWeek', [WEEK_ENDING], [NO_COST_BASIS], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements, TRUCK_ID, null, NOW);
    expect(r2(home.kpi!.net)).toBe(KEY.profit);
    expect(home.kpi!.deposits).toBe(KEY.deposit);
    // R4: Revenue − Expenses = Net Profit on the same card.
    expect(r2(home.kpi!.gross - home.kpi!.expenses.total)).toBe(KEY.profit);
  });

  test('D2: owed to carrier is READ — TOTAL CASH FLOW 1,884.73 > 0, so Home shows nothing', () => {
    expect(printedTotalCashFlow(rows.settlements[0])).toBe(1884.73);
    expect(owedToCarrier(rows.settlements, TRUCK_ID)).toEqual({ total: 0, asOf: null, accounts: [] });
    expect(owedToCarrier(rows.settlements, null).total).toBe(0);
  });
});

describe('statement route and line route agree on the golden week', () => {
  test('both give 2,534.36', async () => {
    const statementRows = await importGolden(statementExtraction());
    const lineRows = await importGolden(goldenExtraction('both'));
    expect(r2(weekKpi(statementRows).net)).toBe(KEY.profit);
    expect(r2(weekKpi(lineRows).net)).toBe(KEY.profit);
  });
});

describe('self-check: a misread number never becomes a silently wrong profit', () => {
  const misread = () => ({
    ...STATEMENT,
    lines: STATEMENT_LINES.map((l) => (l.label === 'TRACTOR FUEL' ? { ...l, amount: -1979.82 } : l)),
  });

  test('one misread line is caught and names its check', () => {
    const check = buildPrimeStatementCheck(statementExtraction({ operating: misread() }))!;
    expect(check.passed).toBe(false);
    expect(check.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['section_fuel_oil_tax']);
  });

  test('a misread subtotal breaks the chain checks', () => {
    const check = buildPrimeStatementCheck(statementExtraction({ operating: { ...STATEMENT, weekTotalOperatingExpenses: -2989.02 } }))!;
    expect(check.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['operatingExpenses', 'statementTotal']);
  });

  test('D2: there is no "Save anyway" — an old override on the reading is ignored and nothing is saved', async () => {
    const flagged = { ...statementExtraction({ operating: misread() }), reconciliationOverride: [{ id: 'section_fuel_oil_tax' }] };
    await expect(importGolden(flagged)).rejects.toThrow(/did not pass its checks \(section_fuel_oil_tax\)\. Nothing was saved/);
    expect((mockClient.__store as Record<string, unknown[]>).settlements ?? []).toEqual([]);
  });
});

describe('BANK DEPOSIT IS READ, NEVER COMPUTED (owner decision 2026-10-13)', () => {
  test('golden deposit 1,884.73 comes from the printed line — SETTLEMENT TO OPERATOR once the statement passes its gate (item 6)', async () => {
    const rows = await importGolden(statementExtraction());
    expect(rows.settlements[0].statement?.printed.deposit).toBe(KEY.deposit);
    expect(rows.settlements[0].statement?.printed.depositSource).toBe('settlement_to_operator');
    expect(settlementDeposit(rows.settlements[0])).toEqual({ deposited: KEY.deposit, owedToCarrier: 0, source: 'settlement_to_operator' });
    // Line route (no statement page): the printed DIRECT DEPOSIT line.
    const lineRows = await importGolden(goldenExtraction('both'));
    expect(settlementDeposit(lineRows.settlements[0])).toEqual({ deposited: KEY.deposit, owedToCarrier: 0, source: 'direct_deposit' });
  });

  test('no deposit line printed -> net due 1,884.36, labeled net due', async () => {
    const rows = await importGolden(goldenExtraction('both', { depositAmount: undefined }));
    expect(settlementDeposit(rows.settlements[0])).toEqual({ deposited: KEY.netDue, owedToCarrier: 0, source: 'net_due' });
  });

  test('the check: net due 1,884.36 + interest 0.37 = deposit 1,884.73 passes; a misread deposit fails and names itself', () => {
    expect(checkSettlementReconciliation(statementExtraction()).ok).toBe(true);
    const bad = checkSettlementReconciliation(statementExtraction({ depositAmount: 1984.73 }));
    expect(bad.issues).toEqual([{ type: 'depositMismatch', stated: 1984.73, computed: expect.closeTo(1884.73, 2) }]);
  });

  test('an owed-to-carrier week (negative net, no deposit line) adds 0 to Deposited', async () => {
    const owed = goldenExtraction('both', {
      depositAmount: undefined,
      grossRevenue: 500,
      revenueItems: [{ desc: 'TRIP REVENUE', amount: 500 }],
      reimbursements: undefined,
      reimbursementItems: [],
      totalDeductions: 750,
      deductions: [D('LP', 'LICENSE/PERMITS', 750)],
      tractorFuel: [],
      reeferFuel: [],
      netPay: -250,
    });
    const rows = await importGolden(owed);
    expect(settlementDeposit(rows.settlements[0])).toEqual({ deposited: 0, owedToCarrier: 250, source: 'owed_to_carrier' });
    const k = weekKpi(rows);
    expect(k.deposits).toBe(0);
    // Batch D2: no KPI sums owed weeks any more (owedToCarrier.ts reads it).
    expect('owedToCarrier' in k).toBe(false);
  });

  test('no code path stores the routing number', async () => {
    const withDigits: Extraction = {
      ...statementExtraction(),
      summary: 'Prime settlement — DIRECT DEPOSIT TO BANK ROUTING #111000025 for 1,884.73',
      vendor: 'Prime Inc — acct 4455667788',
    };
    await importGolden(withDigits);
    const everything = JSON.stringify(mockClient.__store);
    expect(everything).not.toContain('111000025');
    expect(everything).not.toContain('4455667788');
    expect(everything).toContain('1884.73');
  });
});

describe('SOURCE LABELS (Part 2) — other carriers', () => {
  const otherCarrier = (overrides: Partial<NonNullable<Extraction['settlement']>> = {}): Extraction => ({
    docType: 'settlement',
    confidence: 'high',
    settlement: {
      weekEnding: '2026-08-14',
      carrier: 'Landstar Ranger',
      grossRevenue: 3000,
      totalDeductions: 900,
      netPay: 2100,
      totalMiles: 1500,
      revenueItems: [{ desc: 'LINEHAUL', amount: 3000 }],
      deductions: [D('', 'INSURANCE', 400), D('', 'FUEL ADVANCE', 500)],
      ...overrides,
    },
  });

  test('a non-Prime statement with printed totals that add up -> "Totals match"', async () => {
    const rows = await importGolden(otherCarrier());
    expect(rows.settlements[0].statement?.source).toBe('printed_totals');
    expect(settlementVerification(rows.settlements[0])).toBe('totals_match');
  });

  test('D2: one without printed totals is refused ("send report"), nothing saved', async () => {
    await expect(importGolden(otherCarrier({ totalDeductions: undefined, netPay: 2100 }))).rejects.toThrow(/totals_not_printed/);
    expect((mockClient.__store as Record<string, unknown[]>).settlements ?? []).toEqual([]);
  });

  test('Prime rules never touch it — even a Prime-shaped statement page is ignored', async () => {
    const rows = await importGolden(otherCarrier({ operating: STATEMENT }));
    expect(buildPrimeStatementCheck(otherCarrier({ operating: STATEMENT }))).toBeNull();
    expect(rows.settlements[0].statement?.prime).toBeNull();
    expect(rows.settlements[0].carrier).toBe('Landstar Ranger');
  });

  test('a null carrier alone never selects the Prime route', () => {
    expect(buildPrimeStatementCheck({ ...statementExtraction(), settlement: { ...statementExtraction().settlement!, carrier: undefined } })).toBeNull();
  });
});

// PER-GROUP CHECKS (owner decision 2026-10-17, item 5) — warnings only.
describe('per-group checks on the 8/21 golden week', () => {
  test('every group ties; the total differs only by the 0.37 interest income', () => {
    const groups = buildPrimeGroupChecks(statementExtraction())!;
    expect(groups.filter((g) => !g.passed)).toEqual([]);
    expect(groups.find((g) => g.group === 'total')!.difference).toBe(0.37);
    expect(groups.find((g) => g.group === 'advances')).toMatchObject({ settlement: 550, statement: 550 });
  });
});

// Batch 0b.2 (2026-10-30): the withheld/combined Accountant Package scopes
// listed escrow, advance repayment and meals inside "Deductible Expenses".
// They stay listed for reference and never count as deductible.
describe('accountant package — withheld lines are never deductible (0b.2)', () => {
  it('golden W/E 8/21: escrow, advances and meals are reference only, in every scope', async () => {
    const { buildLineItems, buildScheduleCTotals, buildNotDeductibleReference, groupLineItemsByScheduleCBucket } = await import('@/src/stats/accountantPackage');
    const { NON_DEDUCTIBLE_CATEGORIES } = await import('@/src/import/category');
    const rows = await importGolden(goldenExtraction('both'));
    const nonDeductible = new Set<string>(NON_DEDUCTIBLE_CATEGORIES);
    for (const scope of ['outOfPocket', 'withheld', 'combined'] as const) {
      const items = buildLineItems(rows.deductions, rows.fuel, [], [], 2026, 8, scope);
      const totals = buildScheduleCTotals(items, []);
      const deductible = totals.reduce((sum, c) => sum + c.amount, 0);
      const reference = buildNotDeductibleReference(items);
      expect(totals.some((c) => nonDeductible.has(c.category))).toBe(false);
      expect(groupLineItemsByScheduleCBucket(items, totals, []).flatMap((g) => g.items).every((li) => li.deductible)).toBe(true);
      // Every listed row lands in exactly one of the two totals.
      expect(r2(deductible + reference.total)).toBe(r2(items.reduce((sum, li) => sum + li.amount, 0)));
      if (scope !== 'outOfPocket') {
        const escrow = rows.deductions.filter((d) => d.source === 'settlement' && d.category === 'Escrow & Deposits');
        expect(escrow.length).toBeGreaterThan(0);
        expect(reference.items.map((li) => li.id)).toEqual(expect.arrayContaining(escrow.map((d) => d.id)));
        // Before the fix the deductible total was 5,335.73.
        expect(r2(deductible)).toBe(4685.73);
        expect(r2(reference.total)).toBe(650);
      } else {
        expect(reference.total).toBe(0);
      }
    }
  });
});

// ONE GATE ON EVERY SAVE PATH (owner decision 2026-10-30, before batch D).
// A week reaches saveExtraction() either from a live read (aiImportCall.ts)
// or from a background job's stored result_json (importJobs.ts — jobs list,
// Review All, retry, resume, read again). Both now run sanitizeExtraction(),
// and saveExtraction() itself refuses a week the preview's gate blocks.
describe('every save path: same gate, same label, same profit (8/21)', () => {
  const PATHS = {
    live: (e: Extraction) => sanitizeExtraction(e),
    backgroundJob: (e: Extraction) => sanitizeExtraction(JSON.parse(JSON.stringify(e)) as Extraction),
  };
  const misread = () => statementExtraction({
    operating: { ...STATEMENT, lines: STATEMENT_LINES.map((l) => (l.label === 'TRACTOR FUEL' ? { ...l, amount: -1979.82 } : l)) },
  });

  test.each(Object.keys(PATHS) as (keyof typeof PATHS)[])('%s: Verified by Prime statement, profit 2,534.36', async (path) => {
    const rows = await importGolden(PATHS[path](statementExtraction()));
    expect(settlementVerification(rows.settlements[0])).toBe('verified_prime');
    expect(r2(weekKpi(rows).net)).toBe(KEY.profit);
  });

  test.each(Object.keys(PATHS) as (keyof typeof PATHS)[])('%s: a misread number is refused before anything is written, the failing check named', async (path) => {
    const e = PATHS[path](misread());
    expect(e.confidence).toBe('low');
    expect(isSaveBlocked(e)).toBe(true);
    expect(saveGateFailures(e)).toEqual(['section_fuel_oil_tax']);
    await expect(importGolden(e)).rejects.toThrow(/did not pass its checks \(section_fuel_oil_tax\)/);
    expect((mockClient.__store as Record<string, unknown[]>).settlements ?? []).toEqual([]);
    expect((mockClient.__store as Record<string, unknown[]>).documents ?? []).toEqual([]);
  });

  test.each(Object.keys(PATHS) as (keyof typeof PATHS)[])('%s: an unconfirmed 2014 date is refused', async (path) => {
    const e = PATHS[path](statementExtraction({ weekEnding: '2014-08-26', settlementDateRaw: undefined, printDateRaw: undefined, printDate: undefined, statementWeekEndingRaw: undefined }));
    await expect(importGolden(e)).rejects.toThrow(/confirm the week ending/);
    expect((mockClient.__store as Record<string, unknown[]>).settlements ?? []).toEqual([]);
  });

  test('D2: no override path on any save path — an old "Save anyway" flag is refused like any misread', async () => {
    await expect(importGolden({ ...PATHS.backgroundJob(misread()), reconciliationOverride: [{ id: 'section_fuel_oil_tax' }] })).rejects.toThrow(/did not pass its checks/);
    expect((mockClient.__store as Record<string, unknown[]>).settlements ?? []).toEqual([]);
  });
});

// =====================================================================
// PROFIT EXPLAINER (owner decision 2026-10-30, batch D item 8): settlements
// profit − your own expenses = profit, to the cent, on every period.
describe('profit explainer — golden 8/21 with $100 + $50 of own expenses', () => {
  const own = (id: string, amount: number, category: string, ded_date: string, truck_id: string | null = null) =>
    ({ id, user_id: USER_ID, amount, category, description: `${category} receipt`, ded_date, source: 'manual', settlement_id: null, truck_id, tax_deductible: true }) as unknown as Deduction;
  let rows: Rows;
  beforeAll(async () => {
    rows = await importGolden(statementExtraction());
    rows = {
      ...rows,
      deductions: [
        ...rows.deductions,
        own('own-100', 100, 'Supplies', '2026-08-18', TRUCK_ID),
        own('own-50', 50, 'Truck Supplies & Equipment', '2026-08-19'),
        own('own-meal', 24.5, 'Meals (per diem covered)', '2026-08-19'),
      ],
    };
  });
  const kpiFor = (window: { startIso: string; endIso: string } | null, truckScope: string | null = TRUCK_ID) =>
    computeKpis({
      trucks: [NO_COST_BASIS],
      settlements: rows.settlements,
      loads: rows.loads,
      deductions: rows.deductions,
      fuelPurchases: rows.fuel,
      maintenanceRecords: [],
      tolls: [],
      reimbursements: rows.reimbursements,
      truckScope,
      window,
    });

  test('the week: settlements 2,534.36 (Verified), own 150.00 (2 items), profit 2,384.36, nothing unexplained', () => {
    const k = kpiFor({ startIso: WEEK_START, endIso: WEEK_ENDING });
    const e = k.explanation!;
    expect(e.settlementsProfit).toBe(2534.36);
    expect(e.settlementsLabel).toBe('verified_prime');
    expect(e.ownExpenses.total).toBe(150);
    expect(e.ownExpenses.count).toBe(2);
    expect(e.profit).toBe(2384.36);
    expect(r2(k.net)).toBe(2384.36);
    expect(e.residual).toBe(0);
    expect(e.case).toBe('ownExpenses');
    expect(e.tone).toBe('info');
  });

  test('the meal is listed as not counted, with its reason', () => {
    const e = kpiFor({ startIso: WEEK_START, endIso: WEEK_ENDING }).explanation!;
    expect(e.notCounted.map((r) => [r.rowId, r.reason])).toEqual([['own-meal', 'meals_per_diem']]);
    expect(e.ownExpenses.rows.map((r) => r.rowId).sort()).toEqual(['own-100', 'own-50']);
  });

  test.each(['1M', '3M', 'yearly', 'all'] as const)('%s, truck and fleet scope: the same three numbers', (period) => {
    const window = period === 'all' ? null : resolveHeroPeriodDateWindow(period, [WEEK_ENDING], NOW);
    for (const scope of [TRUCK_ID, null]) {
      const e = kpiFor(window, scope).explanation!;
      expect([e.settlementsProfit, e.ownExpenses.total, e.ownExpenses.count, e.profit, e.residual]).toEqual([2534.36, 150, 2, 2384.36, 0]);
    }
  });

  test('without own expenses the Verified week reads "matches Prime" (no warning)', async () => {
    const plain = await importGolden(statementExtraction());
    const e = weekKpi(plain).explanation!;
    expect([e.case, e.tone, e.residual, e.ownExpenses.count]).toEqual(['primeMatch', 'info', 0, 0]);
  });

  test('an own expense never raises a Prime mismatch', () => {
    const k = kpiFor({ startIso: WEEK_START, endIso: WEEK_ENDING });
    expect(k.bridge.crossChecks).toEqual([]);
    expect(k.explanation!.mismatchWeeks).toBe(0);
  });

  test('a possible duplicate of a withheld line is flagged, never dropped; "keep" silences it', () => {
    const withheld = rows.deductions.find((d) => d.source === 'settlement' && d.settlement_id && Number(d.amount) > 0 && /fuel/i.test(d.category ?? ''))!;
    const twin = { ...own('own-twin', Number(withheld.amount), 'Fuel & DEF', withheld.ded_date!), description: 'pump receipt' } as Deduction;
    const withTwin = { ...rows, deductions: [...rows.deductions, twin] };
    const k = computeKpis({ ...kpiInputs(withTwin), window: { startIso: WEEK_START, endIso: WEEK_ENDING } });
    const e = k.explanation!;
    expect(e.possibleDuplicates.map((d) => [d.own.rowId, d.withheld.id])).toEqual([['own-twin', withheld.id]]);
    // Still counted (flag only) and still explained.
    expect(e.ownExpenses.rows.map((r) => r.rowId)).toContain('own-twin');
    expect(e.residual).toBe(0);
    const kept = { ...withTwin, deductions: withTwin.deductions.map((d) => (d.id === 'own-twin' ? ({ ...d, duplicate_kept_at: '2026-10-31T00:00:00Z' } as Deduction) : d)) };
    expect(computeKpis({ ...kpiInputs(kept), window: { startIso: WEEK_START, endIso: WEEK_ENDING } }).explanation!.possibleDuplicates).toEqual([]);
  });

  function kpiInputs(r: Rows) {
    return {
      trucks: [NO_COST_BASIS],
      settlements: r.settlements,
      loads: r.loads,
      deductions: r.deductions,
      fuelPurchases: r.fuel,
      maintenanceRecords: [],
      tolls: [],
      reimbursements: r.reimbursements,
      truckScope: TRUCK_ID,
    };
  }
});

describe('Per-Truck Profitability "Profit" = Home for the same truck and period (batch D item 8)', () => {
  test('golden 8/21 + $150 own: per-truck Profit 2,384.36 = Home (buildPeriodScopedCpm) on every hero period', async () => {
    const base = await importGolden(statementExtraction());
    const deductions = [
      ...base.deductions,
      { id: 'own-100', user_id: USER_ID, amount: 100, category: 'Supplies', description: 'x', ded_date: '2026-08-18', source: 'manual', settlement_id: null, truck_id: TRUCK_ID, tax_deductible: true } as unknown as Deduction,
      { id: 'own-50', user_id: USER_ID, amount: 50, category: 'Supplies', description: 'y', ded_date: '2026-08-19', source: 'manual', settlement_id: null, truck_id: null, tax_deductible: true } as unknown as Deduction,
    ];
    const inputs = { trucks: [NO_COST_BASIS], settlements: base.settlements, loads: base.loads, deductions, fuelPurchases: base.fuel, maintenanceRecords: [], tolls: [], reimbursements: base.reimbursements };
    for (const period of ['thisWeek', '1M', '3M', 'yearly'] as const) {
      const home = buildPeriodScopedCpm(period, [WEEK_ENDING], [NO_COST_BASIS], base.settlements, base.loads, deductions, base.fuel, [], [], base.reimbursements, TRUCK_ID, null, NOW);
      const perTruck = truckHomeProfits(inputs, [TRUCK_ID], home.window).get(TRUCK_ID)!;
      expect(r2(perTruck)).toBe(2384.36);
      expect(perTruck).toBe(home.kpi!.net);
    }
  });
});

// =====================================================================
// SIMPLE IMPORT FLOW (owner decision 2026-10-31, batch D2 2.5): the 8/21
// golden week passes the one gate and shows its printed headline numbers.
describe('batch D2 — the one gate on the 8/21 golden week', () => {
  const gateOf = (e: Extraction) => evaluateSettlementGate(e, { importDate: '2026-10-29', carrierCodes: PRIME_CODES as never })!;

  test('with the statement page: revenue 4,783.75, net due 1,884.36, deposited 1,884.73, miles 2,327 (2,081 / 246), profit 2,534.36', () => {
    const gate = gateOf(statementExtraction());
    expect(gate).toMatchObject({ status: 'pass', lineDetails: 'match' });
    if (gate.status !== 'pass') return;
    expect(gate.headline).toMatchObject({
      weekEnding: WEEK_ENDING,
      revenue: KEY.revenue,
      netDue: KEY.netDue,
      deposited: KEY.deposit,
      owedToCarrier: 0,
      miles: KEY.miles,
      loadedMiles: KEY.loadedMiles,
      emptyMiles: KEY.emptyMiles,
      estimatedProfit: KEY.profit,
      source: 'prime_statement',
    });
  });

  test('a Prime reading with only the settlement pages (no statement page) is checked on its printed totals, profit from the lines', () => {
    const gate = gateOf(goldenExtraction('both'));
    expect(gate).toMatchObject({ status: 'pass', lineDetails: 'match' });
    if (gate.status !== 'pass') return;
    expect(gate.headline).toMatchObject({ revenue: KEY.revenue, netDue: KEY.netDue, estimatedProfit: KEY.profit, source: 'printed_totals' });
  });

  test('no calculation changed: the saved week still gives profit 2,534.36', async () => {
    const rows = await importGolden(statementExtraction());
    expect(r2(weekKpi(rows).net)).toBe(KEY.profit);
  });
});
