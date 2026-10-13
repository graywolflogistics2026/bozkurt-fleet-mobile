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
import { buildPrimeReconciliation } from '@/src/import/primeOperatingStatement';

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
  { desc: 'WIE14MB LD', ref: 'PR', amount: 1 },
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

const OPERATING = {
  weekMiles: 2327,
  weekRevenueFromPrime: 3345.12,
  weekExtraPay: 175,
  weekFuelSurchargeBill: 1210.04,
  weekReeferFuelSurcharge: 20.82,
  weekSafetyIncentive: 16.35,
  weekServiceIncentive: 16.35,
  weekToll1099Pay: 0.07,
  weekTotalRevenue: 4783.75,
  weekFuelOilTax: 1953.78,
  weekMiscellaneous: 589.84,
  weekTotalVariableCosts: 2543.62,
  weekTotalFixedCost: 255.77,
  weekOtherIncomeAndExpense: 99.63,
  weekInterestIncome: 0.37,
  weekTotalOperatingExpenses: 2899.02,
  weekTotalStatement: 1884.73,
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
      operating: OPERATING,
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

function expectAnswerKey(k: KpiResult) {
  expect(r2(k.gross)).toBe(KEY.revenue);
  expect(r2(k.reimbursementsTotal)).toBe(KEY.reimbursements);
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
    expect(buildPrimeReconciliation(goldenExtraction(shape))!.mismatches).toEqual([]);
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
    // The deposit relation lives only in the Prime reconciliation line.
    const prime = buildPrimeReconciliation(goldenExtraction(shape))!;
    expect(r2(prime.netDue! + prime.interestIncome)).toBe(KEY.deposit);
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
    expect(buildPrimeReconciliation(extraction)!.mismatches.map((m) => m.field)).toEqual(['revenue']);
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
  test('profit starts from net due; the .37 interest is only in the Prime reconciliation line', async () => {
    const rows = await importGolden(goldenExtraction('both'));
    expect(weekKpi(rows).bridge.netPay).toBe(KEY.netDue);
    const prime = buildPrimeReconciliation(goldenExtraction('both'))!;
    expect(prime.interestIncome).toBe(KEY.interest);
    expect(prime.totalStatement).toBe(KEY.deposit);
    expect(prime.mismatches).toEqual([]);
  });
});

describe('miles — the week, never LTD/QTD 10,146', () => {
  test('2,327 = 2,081 loaded + 246 empty; 10,146 as the week is flagged by the Prime check', () => {
    expect(buildPrimeReconciliation(goldenExtraction('both', { totalMiles: 10146 }))!.mismatches.map((m) => m.field)).toEqual(['miles']);
  });
});

describe('reconciliation escape hatch — a null printed total never fails a check', () => {
  test('a statement that prints no totals at all passes (nothing to compare, nothing guessed)', () => {
    const extraction = goldenExtraction('both', { totalDeductions: undefined, reimbursements: undefined, grossRevenue: undefined, netPay: -5 });
    expect(checkSettlementReconciliation(extraction)).toEqual({ ok: true, issues: [] });
  });
});
