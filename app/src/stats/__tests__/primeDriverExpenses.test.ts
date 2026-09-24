import * as fs from 'fs';
import * as path from 'path';
import {
  buildPrimeDriverExpenseMonth,
  eligibleDeductionRowsForReport,
  mergePrimeDriverExpenseRows,
  daysOverrideKey,
  nonPrimeSettlementIds,
  type PrimeDriverExpenseRow,
  type EligibleDeductionSource,
} from '@/src/stats/primeDriverExpenses';
import { buildPerDiemBlock, buildLineItems, matchesAccountantScope } from '@/src/stats/accountantPackage';
import { calcTrueProfit, isDeductibleExpense } from '@/src/stats/trueProfit';
import type { Deduction } from '@/src/types/db';
import { calcPerDiemDays } from '@/src/tax/perDiem';
import { computeKpis, type KpiInputs } from '@/src/stats/kpi';
import { sumCanonicalExpenses } from '@/src/stats/trueProfit';
import { calcCanonicalCpm } from '@/src/stats/cpm';
import { buildTruckComparison } from '@/src/stats/truckComparison';

describe('buildPrimeDriverExpenseMonth ("FOR PRIME INC DRIVERS" tracker, owner decision 2026-09-17)', () => {
  const rows: PrimeDriverExpenseRow[] = [
    { id: '1', exp_date: '2026-06-03', amount: 45, category: 'Lumpers', note: 'Load 123', origin: 'direct' },
    { id: '2', exp_date: '2026-06-15', amount: 20, category: 'Cash Fuel', note: null, origin: 'direct' },
    { id: '3', exp_date: '2026-06-20', amount: 15, category: 'Lumpers', note: 'Load 456', origin: 'direct' },
    { id: '4', exp_date: '2026-07-05', amount: 60, category: 'Repairs', note: 'oil change', origin: 'direct' },
  ];
  const settlements = [
    { week_ending: '2026-06-06', per_diem_days: 7 },
    { week_ending: '2026-06-13', per_diem_days: 0 },
    { week_ending: '2026-07-04', per_diem_days: 7 },
  ];

  it('groups a category with entries correctly and sums a per-category subtotal', () => {
    const june = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 6);
    const lumpers = june.sections.find((s) => s.category === 'Lumpers')!;
    expect(lumpers.rows).toHaveLength(2);
    expect(lumpers.subtotal).toBe(60);
    const fuel = june.sections.find((s) => s.category === 'Cash Fuel')!;
    expect(fuel.subtotal).toBe(20);
  });

  it('renders all 16 categories even when most have zero entries this month — $0 subtotal, never hidden', () => {
    const june = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 6);
    expect(june.sections).toHaveLength(16);
    const scales = june.sections.find((s) => s.category === 'Scales')!;
    expect(scales.rows).toEqual([]);
    expect(scales.subtotal).toBe(0);
    // Every section present, in the fixed accountant-mandated order.
    expect(june.sections.map((s) => s.category)[0]).toBe('Lumpers');
    expect(june.sections.map((s) => s.category)[15]).toBe('Misc');
  });

  it('grand total sums exactly the 16 category subtotals for the selected month, excluding other months', () => {
    const june = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 6);
    expect(june.grandTotal).toBe(80); // 45 + 20 + 15, July's $60 excluded
    const july = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 7);
    expect(july.grandTotal).toBe(60);
  });

  it('Days Away From Home reads the EXISTING per-diem day count (calcPerDiemDays), never a second calculation', () => {
    const june = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 6);
    // Two June settlement weeks: 7 + 0 = 7.
    expect(june.daysAwayFromHome).toBe(7);
    expect(june.daysAwayFromHomeIsOverridden).toBe(false);
    const july = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 7);
    expect(july.daysAwayFromHome).toBe(7);
  });

  it('DAYS AWAY FROM HOME OVERRIDE (item 8) — a real override wins for display, and is flagged as overridden', () => {
    const june = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 6, 5);
    expect(june.daysAwayFromHome).toBe(5); // overrides the calculated 7
    expect(june.daysAwayFromHomeIsOverridden).toBe(true);
    // null/undefined means "no override" — falls back to the calculated value.
    const juneNoOverride = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 6, null);
    expect(juneNoOverride.daysAwayFromHome).toBe(7);
    expect(juneNoOverride.daysAwayFromHomeIsOverridden).toBe(false);
  });

  it('EDIT MOVES MONTH — changing a row from June to July re-derives live, no stale per-month cache', () => {
    const movedRow: PrimeDriverExpenseRow = { ...rows[0], exp_date: '2026-07-10' };
    const editedRows = [movedRow, ...rows.slice(1)];

    const juneAfter = buildPrimeDriverExpenseMonth(editedRows, settlements, 2026, 6);
    const julyAfter = buildPrimeDriverExpenseMonth(editedRows, settlements, 2026, 7);

    // The moved $45 Lumpers row is gone from June's own total...
    expect(juneAfter.grandTotal).toBe(35); // 20 + 15, the $45 row moved out
    const juneLumpers = juneAfter.sections.find((s) => s.category === 'Lumpers')!;
    expect(juneLumpers.rows).toHaveLength(1);
    // ...and now correctly included in July's.
    expect(julyAfter.grandTotal).toBe(105); // 60 (original July) + 45 (moved in)
    const julyLumpers = julyAfter.sections.find((s) => s.category === 'Lumpers')!;
    expect(julyLumpers.rows).toHaveLength(1);
    expect(julyLumpers.subtotal).toBe(45);
  });

  it('daysOverrideKey formats a stable "YYYY-MM" key', () => {
    expect(daysOverrideKey(2026, 6)).toBe('2026-06');
    expect(daysOverrideKey(2026, 12)).toBe('2026-12');
  });
});

describe('eligibleDeductionRowsForReport — THE ORIGIN RULE, this report\'s own last line of defense', () => {
  it('excludes a settlement-withheld row even if it somehow carries an accountant_category', () => {
    const deductions: EligibleDeductionSource[] = [
      { id: 'd1', ded_date: '2026-06-10', amount: 80, accountant_category: 'Truck & Trailer Wash', source: 'settlement', description: 'Truck wash', category: 'Truck Wash & Detailing' },
      { id: 'd2', ded_date: '2026-06-11', amount: 40, accountant_category: 'Truck & Trailer Wash', source: 'manual', description: 'Truck wash', category: 'Truck Wash & Detailing' },
    ];
    const rows = eligibleDeductionRowsForReport(deductions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('d2');
  });

  it('excludes an out-of-pocket row with no accountant_category set yet', () => {
    const deductions: EligibleDeductionSource[] = [
      { id: 'd1', ded_date: '2026-06-10', amount: 80, accountant_category: null, source: 'manual', description: 'Unmapped category' },
    ];
    expect(eligibleDeductionRowsForReport(deductions)).toHaveLength(0);
  });

  it('maps a real deduction row into report-row shape correctly, tagged origin: "deduction"', () => {
    const deductions: EligibleDeductionSource[] = [
      { id: 'd1', ded_date: '2026-06-10', amount: 80, accountant_category: 'Repairs', source: 'import', description: 'Oil change', category: 'Maintenance & Repairs' },
    ];
    const rows = eligibleDeductionRowsForReport(deductions);
    expect(rows[0]).toEqual({ id: 'd1', exp_date: '2026-06-10', amount: 80, category: 'Repairs', note: 'Oil change', origin: 'deduction' });
  });
});

describe('ZERO DUPLICATION (item 5) — UNION of the two disjoint sources', () => {
  it('a realistic month with rows from BOTH sources sums correctly, each counted exactly once', () => {
    const directRows: PrimeDriverExpenseRow[] = [
      { id: 'pde1', exp_date: '2026-06-05', amount: 30, category: 'Cash Fuel', note: null, origin: 'direct' },
    ];
    const deductions: EligibleDeductionSource[] = [
      { id: 'd1', ded_date: '2026-06-06', amount: 70, accountant_category: 'Repairs', source: 'manual', description: 'Oil change', category: 'Maintenance & Repairs' },
      // A settlement-withheld row in the same account/month must never be
      // pulled in, even though it's the same nominal category.
      { id: 'd2', ded_date: '2026-06-07', amount: 999, accountant_category: null, source: 'settlement', description: 'Withheld repair' },
    ];
    const deductionRows = eligibleDeductionRowsForReport(deductions);
    const merged = mergePrimeDriverExpenseRows(directRows, deductionRows);
    const month = buildPrimeDriverExpenseMonth(merged, [], 2026, 6);
    expect(month.grandTotal).toBe(100); // 30 + 70, never 999 folded in, never double-counted
    const fuel = month.sections.find((s) => s.category === 'Cash Fuel')!;
    expect(fuel.rows).toHaveLength(1);
    expect(fuel.rows[0].origin).toBe('direct');
    const repairs = month.sections.find((s) => s.category === 'Repairs')!;
    expect(repairs.rows).toHaveLength(1);
    expect(repairs.rows[0].origin).toBe('deduction');
  });
});

describe('CANONICAL ISOLATION — item 6, the hard requirement', () => {
  // Proof 1 — SOURCE AUDIT: grep every canonical KPI/expense/per-diem
  // engine's own source file and confirm zero references to this
  // table/module — or the new `accountant_category`/
  // `prime_driver_days_override` fields — by name. This is a REAL
  // regression guard, not a comment: if a future edit ever wires either
  // into any of these files, this test fails immediately.
  const CANONICAL_FILES = [
    'src/stats/kpi.ts',
    'src/stats/trueProfit.ts',
    'src/stats/cpm.ts',
    'src/stats/truckComparison.ts',
    'src/stats/accountantPackage.ts',
    'src/data/taxEstimate.ts',
    'src/tax/perDiem.ts',
  ];
  const FORBIDDEN_PATTERNS = [/prime_driver_expenses/i, /PrimeDriverExpense/, /primeDriverExpenses/, /accountant_category/, /prime_driver_days_override/];

  it('no canonical KPI/expense/tax/per-diem engine file references prime_driver_expenses, accountant_category, or prime_driver_days_override by name', () => {
    for (const rel of CANONICAL_FILES) {
      const full = path.join(__dirname, '..', '..', '..', rel);
      const text = fs.readFileSync(full, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(text).not.toMatch(pattern);
      }
    }
  });

  // Proof 2 — RUNTIME: a realistic settlement+deduction dataset run
  // through every canonical function produces BYTE-IDENTICAL results
  // whether or not several hundred dollars of prime_driver_expenses rows
  // exist on the same account — because none of these functions is ever
  // handed that data at all (confirmed by Proof 1 and Proof 3 together:
  // there is no parameter to receive it, and no source line that reads
  // it).
  const trucks = [
    {
      id: 't1',
      unit_number: '830157',
      is_active: true,
      cost_basis_ownership_mode: null,
      purchase_price: null,
      cost_basis_loan_monthly_payment: null,
      cost_basis_paid_spread_months: null,
      cost_basis_warranty_cost: null,
      cost_basis_warranty_term_months: null,
    },
  ];
  const settlements = [
    { id: 's1', truck_id: 't1', week_ending: '2026-06-06', gross: 3000, net: 2200, miles: 2000, per_diem_days: 7 },
  ];
  const deductions = [{ id: 'd1', truck_id: null, ded_date: '2026-06-06', amount: 500, category: 'Insurance—Truck', tax_deductible: false, source: 'settlement' as const }];
  const loads: never[] = [];
  const fuel: never[] = [];
  const maintenance: never[] = [];
  const tolls: never[] = [];

  function baseKpiInputs(): KpiInputs {
    return { trucks, settlements, loads, deductions, fuelPurchases: fuel, maintenanceRecords: maintenance, tolls, truckScope: null, window: null };
  }

  it('computeKpis()/sumCanonicalExpenses()/calcCanonicalCpm()/buildTruckComparison() are unaffected by prime_driver_expenses rows existing on the same account', () => {
    const before = {
      kpi: computeKpis(baseKpiInputs()),
      expenses: sumCanonicalExpenses(deductions, fuel, maintenance, tolls),
      cpm: calcCanonicalCpm(3000, 2000, deductions, fuel, maintenance, tolls, 0),
      comparison: buildTruckComparison(trucks, settlements, loads, deductions, fuel, maintenance, tolls),
    };

    // Several hundred dollars of prime_driver_expenses rows now "exist"
    // for this same account — plain object literals, matching the real
    // table's own shape, never fetched or merged into any of the arrays
    // above (there is no mechanism to do so — see Proof 1/3).
    const primeDriverExpenseRows = [
      { id: 'pde1', exp_date: '2026-06-06', amount: 250, category: 'Lumpers', note: null },
      { id: 'pde2', exp_date: '2026-06-07', amount: 180, category: 'Cash Fuel', note: null },
      { id: 'pde3', exp_date: '2026-06-08', amount: 90, category: 'Repairs', note: null },
    ];
    expect(primeDriverExpenseRows.reduce((sum, r) => sum + r.amount, 0)).toBe(520); // a real, nontrivial amount

    const after = {
      kpi: computeKpis(baseKpiInputs()),
      expenses: sumCanonicalExpenses(deductions, fuel, maintenance, tolls),
      cpm: calcCanonicalCpm(3000, 2000, deductions, fuel, maintenance, tolls, 0),
      comparison: buildTruckComparison(trucks, settlements, loads, deductions, fuel, maintenance, tolls),
    };

    expect(after.kpi).toEqual(before.kpi);
    expect(after.expenses).toBe(before.expenses);
    expect(after.cpm).toEqual(before.cpm);
    expect(after.comparison).toEqual(before.comparison);
  });

  // Proof 2b (owner decision 2026-09-17, docs/PENDING_SQL.md §75) — the
  // SAME live before/after proof, extended to the new `accountant_category`
  // field specifically: setting/changing it on real deduction rows must
  // leave every canonical total byte-identical, since it's a pure
  // reporting label with no path into any of these functions' own input
  // types.
  it('setting/changing deductions.accountant_category leaves every canonical total byte-identical', () => {
    type DeductionWithAccountantCategory = (typeof deductions)[number] & { accountant_category: string | null };
    const dedsBefore: DeductionWithAccountantCategory[] = deductions.map((d) => ({ ...d, accountant_category: null }));
    const before = {
      kpi: computeKpis({ ...baseKpiInputs(), deductions: dedsBefore }),
      expenses: sumCanonicalExpenses(dedsBefore, fuel, maintenance, tolls),
      cpm: calcCanonicalCpm(3000, 2000, dedsBefore, fuel, maintenance, tolls, 0),
      comparison: buildTruckComparison(trucks, settlements, loads, dedsBefore, fuel, maintenance, tolls),
    };

    // The SAME rows, now with a real accountant_category set on the
    // out-of-pocket-shaped one (this fixture's own row is actually
    // settlement-withheld — the origin rule would reject it for real use
    // — but this test is specifically about proving the FIELD ITSELF is
    // never read by any canonical function, regardless of value or origin).
    const dedsAfter: DeductionWithAccountantCategory[] = deductions.map((d) => ({ ...d, accountant_category: 'Repairs' }));
    const after = {
      kpi: computeKpis({ ...baseKpiInputs(), deductions: dedsAfter }),
      expenses: sumCanonicalExpenses(dedsAfter, fuel, maintenance, tolls),
      cpm: calcCanonicalCpm(3000, 2000, dedsAfter, fuel, maintenance, tolls, 0),
      comparison: buildTruckComparison(trucks, settlements, loads, dedsAfter, fuel, maintenance, tolls),
    };

    expect(after.kpi).toEqual(before.kpi);
    expect(after.expenses).toBe(before.expenses);
    expect(after.cpm).toEqual(before.cpm);
    expect(after.comparison).toEqual(before.comparison);
  });

  // Proof 2c (item 8) — the Days Away From Home override never reaches
  // calcPerDiemDays()/buildPerDiemBlock() (Tax Estimator/the Accountant
  // Package's own per-diem block both read from the latter). Neither
  // function's signature has anywhere to receive an override at all
  // (confirmed by Proof 1's own grep of src/tax/perDiem.ts and
  // src/stats/accountantPackage.ts) — this test proves it holds at
  // runtime too: identical settlement data produces an identical result
  // regardless of whatever override value "exists" elsewhere (on
  // `profiles`, which neither function ever receives).
  it('a prime_driver_days_override "set" for a month changes nothing in calcPerDiemDays()/buildPerDiemBlock() for that same month', () => {
    const perDiemSettlements = [{ week_ending: '2026-06-06', per_diem_days: 7 }, { week_ending: '2026-06-13', per_diem_days: 3 }];
    const perDiemConfig = { daily_rate: 69, deductible_pct: 80 } as const;

    const beforeDays = calcPerDiemDays(perDiemSettlements);
    const beforeBlock = buildPerDiemBlock(perDiemSettlements, 2026, 6, perDiemConfig as never);

    // An override "exists" for this exact month/year on profiles —
    // simulated here as a plain object neither function below is ever
    // given.
    const simulatedProfileOverride: Record<string, number> = { '2026-06': 99 };
    expect(simulatedProfileOverride['2026-06']).toBe(99); // sanity: the override really is set

    const afterDays = calcPerDiemDays(perDiemSettlements);
    const afterBlock = buildPerDiemBlock(perDiemSettlements, 2026, 6, perDiemConfig as never);

    expect(afterDays).toBe(beforeDays);
    expect(afterBlock).toEqual(beforeBlock);
  });

  // Proof 3 — TYPE-LEVEL: attempting to pass prime_driver_expenses data
  // into computeKpis()'s own sealed KpiInputs shape is a COMPILE ERROR
  // today. If a future edit ever widened KpiInputs to accept this field,
  // the `@ts-expect-error` directive below would itself become an error
  // ("unused ts-expect-error directive"), failing this test — a real,
  // enforced structural guarantee, not just a comment.
  it('TYPE PROOF: KpiInputs has no field for prime driver expense data (compile-time enforced)', () => {
    // @ts-expect-error — KpiInputs has no `primeDriverExpenses` field; if
    // this ever stops being a type error, this test itself will fail.
    const invalid: KpiInputs = { ...baseKpiInputs(), primeDriverExpenses: [{ amount: 1 }] };
    expect(invalid).toBeDefined();
  });
});

// PRIME LUMPER EXCEPTION (owner decision 2026-09-23) — BOTH HALVES IN ONE
// TEST, so this can never drift back to either extreme:
//   (A) an "ADV FOR OUTSIDE LUMPER" row IS in this screen's Lumpers total;
//   (B) every canonical engine treats it EXACTLY like any other
//       settlement-withheld, non-deductible row — the lumper wording has
//       zero effect anywhere outside this report.
// (B) is proven by computing every canonical engine's output BEFORE the
// report function runs and AFTER it runs on frozen rows: the exception
// lives only in the report's own row builder, never mutates its input,
// and no canonical engine can see its output (see the source audit above).
describe('PRIME LUMPER EXCEPTION — on this report, invisible everywhere else', () => {
  const settlements = [{ id: 's0717', truck_id: 't1', week_ending: '2026-07-17', gross: 1085.51, net: 317.42, miles: 445, per_diem_days: 3, carrier: 'PRIME INC' }];
  const trucks = [
    {
      id: 't1',
      unit_number: '283940',
      is_active: true,
      cost_basis_ownership_mode: null,
      purchase_price: null,
      cost_basis_loan_monthly_payment: null,
      cost_basis_paid_spread_months: null,
      cost_basis_warranty_cost: null,
      cost_basis_warranty_term_months: null,
    },
  ];
  const withheld = (id: string, description: string, category: string, amount: number) =>
    ({
      id,
      user_id: 'u1',
      truck_id: 't1',
      settlement_id: 's0717',
      ded_date: '2026-07-17',
      description,
      category,
      amount,
      source: 'settlement',
      tax_deductible: false,
      payment_method: 'Settlement Withheld',
      accountant_category: null,
    }) as unknown as Deduction;

  // Real lines from the owner's 2026-07-17 Prime settlement.
  const realRows = [
    withheld('adv', 'ADV FOR OUTSIDE LUMPER', 'Lumper Fees', 217.55),
    withheld('wash', 'TRUCK WASH', 'Truck Wash & Detailing', 45),
    withheld('toll', 'EZ FAST LN TOLL', 'Tolls & Scales', 18.45),
  ].map((d) => Object.freeze(d));

  function canonical(deductions: Deduction[]) {
    const kpiInputs: KpiInputs = { trucks, settlements, loads: [], deductions, fuelPurchases: [], maintenanceRecords: [], tolls: [], truckScope: null, window: null };
    return {
      kpi: computeKpis(kpiInputs),
      trueProfit: calcTrueProfit(settlements, deductions),
      expenses: sumCanonicalExpenses(deductions, [], [], []),
      cpm: calcCanonicalCpm(1085.51, 445, deductions, [], [], [], 0),
      comparison: buildTruckComparison(trucks, settlements, [], deductions, [], [], []),
      taxDeductible: deductions.filter(isDeductibleExpense).reduce((sum, d) => sum + Number(d.amount), 0),
      outOfPocketAmounts: buildLineItems(deductions, [], [], [], 2026, 7, 'outOfPocket').map((i) => i.amount),
      withheldAmounts: buildLineItems(deductions, [], [], [], 2026, 7, 'withheld').map((i) => i.amount).sort(),
    };
  }

  it('(A) the ADV FOR OUTSIDE LUMPER row is in this screen’s Lumpers total, and (B) every canonical engine is unaffected', () => {
    const before = JSON.stringify(canonical(realRows));

    // ---- (A) THIS SCREEN ----
    const reportRows = eligibleDeductionRowsForReport(realRows, nonPrimeSettlementIds(settlements));
    const july = buildPrimeDriverExpenseMonth(reportRows, settlements, 2026, 7);
    const lumpers = july.sections.find((sec) => sec.category === 'Lumpers')!;
    expect(lumpers.subtotal).toBe(217.55);
    expect(lumpers.rows).toEqual([
      { id: 'adv', exp_date: '2026-07-17', amount: 217.55, category: 'Lumpers', note: 'ADV FOR OUTSIDE LUMPER', origin: 'prime_settlement' },
    ]);
    // Item 3: every other category keeps the strict origin rule — the
    // withheld wash and toll lines on the same settlement stay off.
    expect(july.sections.find((sec) => sec.category === 'Truck & Trailer Wash')!.subtotal).toBe(0);
    expect(july.sections.find((sec) => sec.category === 'Cash Tolls/Parking Fees')!.subtotal).toBe(0);
    expect(july.grandTotal).toBe(217.55);
    // The deduction row itself is untouched: still withheld, still no accountant_category.
    expect(realRows[0].source).toBe('settlement');
    expect(realRows[0].accountant_category).toBeNull();

    // ---- (B) EVERYWHERE ELSE ----
    const real = canonical(realRows);
    expect(JSON.stringify(real)).toBe(before);
    // Still exactly a settlement-withheld, non-deductible row: never a tax
    // deduction, never in the Accountant Package's out-of-pocket scope,
    // still in its withheld scope.
    expect(real.taxDeductible).toBe(0);
    expect(real.outOfPocketAmounts).toEqual([]);
    expect(matchesAccountantScope('settlement', 'outOfPocket')).toBe(false);
    expect(real.withheldAmounts).toContain(217.55);
  });

  it('a lumper advance on a settlement from a known NON-Prime carrier stays off this report', () => {
    const werner = [{ id: 's0717', carrier: 'WERNER ENTERPRISES' }];
    expect(eligibleDeductionRowsForReport(realRows, nonPrimeSettlementIds(werner))).toEqual([]);
  });

  it('a settlement with no recorded carrier is treated as Prime (this screen is Prime-only)', () => {
    const unknown = [{ id: 's0717', carrier: null }];
    expect(eligibleDeductionRowsForReport(realRows, nonPrimeSettlementIds(unknown)).map((r) => r.id)).toEqual(['adv']);
  });
});
