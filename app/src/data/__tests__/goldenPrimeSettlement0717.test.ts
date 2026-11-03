// THIRD GOLDEN SETTLEMENT — Prime Inc, week ending 2026-07-17 (IMPORT GATE
// FIX part 3, owner 2026-11-03). The template variations: card payout, no
// cash-flow section, sections on other pages, personal payment + advances
// inside the reimbursement section, zero empty miles, and a LOSS
// (profit −293.62). Fixture: golden0717Fixture.ts (owner transcription).
import { evaluateSettlementGate, rereadRequestFor } from '@/src/import/settlementGate';
import type { Extraction } from '@/src/import/types';
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
import { buildPrimeStatementCheck, isGateCheck, settlementDeposit } from '@/src/import/settlementStatement';
import { nonReimbursementCredits } from '@/src/import/settlementLineClass';
import { KEY, USER_ID, TRUCK_ID, WEEK_ENDING, STATEMENT, STATEMENT_LINES, REIMBURSEMENT_ITEMS, PAGE_MAP, golden0717 } from './golden0717Fixture';

const WEEK_START = '2026-07-11';
const NOW = new Date('2026-07-18T12:00:00');

// Prime codes this week uses, with their §84 class (docs/CARRIER_CODES.md).
const PRIME_CODES = [
  ['CS', 'STOR 01', 'COMPANY STORE', 'Truck Supplies & Equipment', true, 'EXPENSE_VARIABLE'],
  ['LM', 'LMPR', 'OUTSIDE LUMPER', 'Lumper Fees', true, 'EXPENSE_VARIABLE'],
  ['PB', null, 'P/B ADJUSTMENT', 'Escrow & Deposits', false, 'REFUNDABLE_FUND'],
  ['PO', 'PPOS 01', 'POINT OF SALE', 'Meals (per diem covered)', false, 'PERSONAL'],
  ['QR', null, 'QUALCOMM RENTAL', 'ELD & Communications', true, 'EXPENSE_FIXED'],
  ['RF', 'FUEL 02', 'REEFER FUEL', 'Fuel & DEF', true, 'EXPENSE_VARIABLE'],
  ['UD', null, 'TRAC FUEL DSCNT', null, null, 'REIMBURSEMENT'],
  ['UF', 'FUEL 01', 'TRACTOR FUEL', 'Fuel & DEF', true, 'EXPENSE_VARIABLE'],
  ['UR', 'REPR 01', 'TRACTOR REPAIR', 'Maintenance & Repairs', true, 'EXPENSE_VARIABLE'],
  ['WA', 'ADV 01', 'ADVANCE', 'Advance Repayment', false, 'REPAYMENT'],
].map(([code, sub_code, label, category, is_deductible, economic_class]) => ({
  carrier: 'PRIME INC',
  code,
  sub_code,
  label,
  description: null,
  category,
  is_deductible,
  income_or_chargeback: null,
  notes: null,
  economic_class,
  class_when_charge: null,
}));
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
  economicClass: c.economic_class as string,
  classWhenCharge: null,
}));

type Rows = { settlements: Settlement[]; loads: Load[]; deductions: Deduction[]; fuel: FuelPurchase[]; reimbursements: Reimbursement[]; capital: { tx_type: string; amount: number; linked_deduction_id: string | null }[] };

async function importWeek(extraction: Extraction): Promise<Rows> {
  mockClient = createFakeSupabase({
    profiles: [{ user_id: USER_ID, business_balance: 0 }],
    carrier_code_maps: PRIME_CODES,
  });
  await saveExtraction({
    importDate: '2026-11-03',
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
    capital: (store.capital_transactions ?? []) as Rows['capital'],
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

const gateOf = (e: Extraction) => evaluateSettlementGate(e, { importDate: "2026-11-03", carrierCodes: CODES })!;
const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
const gateFailures = (e: Extraction) =>
  buildPrimeStatementCheck(e)!
    .checks.filter((c) => !c.passed && isGateCheck(c))
    .map((c) => c.id);
const withStatement = (op: Partial<typeof STATEMENT>, s: Partial<NonNullable<Extraction['settlement']>> = {}) =>
  golden0717({ operating: { ...STATEMENT, ...op }, ...s });

// =====================================================================
describe('golden week 2026-07-17 — card payout, no cash-flow section, a loss', () => {
  let rows: Rows;
  beforeAll(async () => {
    rows = await importWeek(golden0717());
  });

  test('the gate passes: every printed-total check ties; no cash-flow section is skipped, never failed', () => {
    expect(checkSettlementReconciliation(golden0717()).issues.filter((i) => i.type === 'netDueMismatch' || i.type === 'depositMismatch')).toEqual([]);
    expect(gateFailures(golden0717())).toEqual([]);
    const gate = gateOf(golden0717());
    expect(gate.status).toBe('pass');
    const ids = buildPrimeStatementCheck(golden0717())!.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['statementTotal', 'settlementToOperator', 'directDeposit']));
    expect(rows.settlements[0].statement?.source).toBe('prime_statement');
  });

  test('computeKpis(): revenue 1,085.51, expenses 1,379.13, profit −293.62, fixed 75.40, miles 445 / 445 / 0', () => {
    for (const scope of [TRUCK_ID, null]) {
      const k = weekKpi(rows, scope);
      expect(r2(k.gross)).toBe(KEY.revenue);
      expect(r2(k.expenses.total)).toBe(KEY.expenses);
      expect(r2(k.expenses.fixed)).toBe(KEY.fixed);
      expect(r2(k.net)).toBe(KEY.profit);
      expect(k.miles.total).toBe(KEY.miles);
      expect(k.miles.loaded).toBe(KEY.loadedMiles);
      expect(k.miles.empty).toBe(KEY.emptyMiles);
      expect(k.deposits).toBe(KEY.payout);
    }
  });

  test('bridge: 317.42 − 0 + (550.00 − 4,459.59) + (177.55 − 3,999.00) + 100.00 + 7,020.00 = −293.62, residual 0', () => {
    const b = weekKpi(rows).bridge;
    expect(b.depositStart).toBe(KEY.payout);
    expect(b.balanceForward).toBe(0);
    expect(b.interestIncome).toBe(0);
    expect(b.difference).toBe(0);
    expect(r2(b.profit)).toBe(KEY.profit);
    const addBacks = r2(b.statementAddBacks.reduce((s, a) => s + a.amount, 0));
    expect(addBacks).toBe(r2(550 - 4459.59 + (177.55 - 3999) + 100 + 7020));
  });

  test('payout is read: AMOUNT LOADED ON CARD 317.42 = SETTLEMENT TO OPERATOR, method card', () => {
    expect(settlementDeposit(rows.settlements[0])).toMatchObject({ deposited: KEY.payout, owedToCarrier: 0 });
    expect(rows.settlements[0].statement?.printed).toMatchObject({ deposit: KEY.payout, balanceForward: 0, payoutMethod: 'card' });
  });

  test('Home, weekly trend, Profit Analysis, Per-Truck and calcTrueProfit all give −293.62', () => {
    const home = buildPeriodScopedCpm('thisWeek', [WEEK_ENDING], [TRUCK], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements, TRUCK_ID, null, NOW);
    expect(r2(home.kpi!.net)).toBe(KEY.profit);
    const trend = buildWeeklyTrueProfitTrend(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements);
    expect(trend).toHaveLength(1);
    expect(r2(trend[0].net)).toBe(KEY.profit);
    const pa = buildProfitAnalysis(rows.settlements, rows.fuel, [], rows.deductions, rows.reimbursements, WEEK_START, NOW, []);
    expect(r2(pa.revenue)).toBe(KEY.revenue);
    expect(r2(pa.netIncome)).toBe(KEY.profit);
    const row = buildTruckComparison([TRUCK], rows.settlements, rows.loads, rows.deductions, rows.fuel, [], [], rows.reimbursements).rows[0];
    expect(r2(row.netProfit)).toBe(KEY.profit);
    expect(r2(calcTrueProfit(rows.settlements, rows.deductions, rows.fuel, [], [], rows.reimbursements))).toBe(KEY.profit);
  });

  test('2.4: only RF 5.34 is saved as a reimbursement; PR personal payment and WA advances are credit lines out of profit', () => {
    // Every PR is PERSONAL, whatever its text (owner 2026-11-03).
    expect(nonReimbursementCredits([{ code: 'PR', desc: 'WIE14MB LD', amount: 1 }], 'PRIME INC', CODES)).toEqual([{ index: 0, economicClass: 'PERSONAL', category: null }]);
    expect(nonReimbursementCredits(REIMBURSEMENT_ITEMS, 'PRIME INC', CODES)).toEqual([
      { index: 0, economicClass: 'PERSONAL', category: null },
      { index: 1, economicClass: 'REPAYMENT', category: 'Advance Repayment' },
      { index: 2, economicClass: 'REPAYMENT', category: 'Advance Repayment' },
    ]);
    // Carrier isolation: an unseeded carrier keeps every line a reimbursement.
    expect(nonReimbursementCredits(REIMBURSEMENT_ITEMS, 'OTHER CARRIER', CODES)).toEqual([]);
    expect(rows.reimbursements.map((r) => r2(Number(r.amount)))).toEqual([5.34]);
  });

  test('PR 3,999.00 flows into Owner\'s money as one contribution linked to its credit line', () => {
    const pr = rows.deductions.find((d) => d.code === 'PR')!;
    expect(Number(pr.amount)).toBe(-3999);
    expect(rows.capital).toEqual([expect.objectContaining({ tx_type: 'contribution', amount: 3999, linked_deduction_id: pr.id })]);
  });
});

// =====================================================================
describe('template variations pass; a misread printed total still blocks', () => {
  test('shuffled page order and shuffled statement lines pass', async () => {
    const shuffledMap = [...PAGE_MAP].reverse().map((p) => ({ ...p }));
    const e = golden0717({ operating: { ...STATEMENT, lines: [...STATEMENT_LINES].reverse() } }, { pageMap: shuffledMap as Extraction['pageMap'] });
    expect(gateOf(e).status).toBe('pass');
    const rows = await importWeek(e);
    expect(r2(weekKpi(rows).net)).toBe(KEY.profit);
  });

  test('zero empty miles is a number, not missing', () => {
    expect(gateFailures(golden0717())).toEqual([]);
    expect(golden0717().settlement!.loads![0].emptyMiles).toBe(0);
  });

  test('a misread TOTAL STATEMENT blocks and the failure names it with both numbers', () => {
    const e = withStatement({ weekTotalStatement: 371.42 });
    const gate = gateOf(e);
    expect(gate.status).toBe('fail');
    if (gate.status !== "fail") throw new Error("expected fail");
    expect(gate.failures).toContain('statementTotal');
    expect(gate.details).toEqual(expect.arrayContaining([{ check: 'statementTotal', printed: 371.42, read: 317.42 }]));
    // The re-read targets the statement pages only.
    expect(rereadRequestFor(gate, e)!.pages).toEqual([4, 5]);
  });

  test('a misread payout blocks (card 371.42 vs SETTLEMENT TO OPERATOR 317.42)', () => {
    const e = withStatement({ directDeposit: 371.42 }, { depositAmount: 371.42 });
    expect(gateOf(e).status).toBe('fail');
  });
});
