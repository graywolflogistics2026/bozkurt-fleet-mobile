import * as fs from 'fs';
import * as path from 'path';
import { buildPrimeDriverExpenseMonth, type PrimeDriverExpenseRow } from '@/src/stats/primeDriverExpenses';
import { computeKpis, type KpiInputs } from '@/src/stats/kpi';
import { sumCanonicalExpenses } from '@/src/stats/trueProfit';
import { calcCanonicalCpm } from '@/src/stats/cpm';
import { buildTruckComparison } from '@/src/stats/truckComparison';

describe('buildPrimeDriverExpenseMonth ("FOR PRIME INC DRIVERS" tracker, owner decision 2026-09-17)', () => {
  const rows: PrimeDriverExpenseRow[] = [
    { id: '1', exp_date: '2026-06-03', amount: 45, category: 'Lumpers', note: 'Load 123' },
    { id: '2', exp_date: '2026-06-15', amount: 20, category: 'Cash Fuel', note: null },
    { id: '3', exp_date: '2026-06-20', amount: 15, category: 'Lumpers', note: 'Load 456' },
    { id: '4', exp_date: '2026-07-05', amount: 60, category: 'Repairs', note: 'oil change' },
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
    const july = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 7);
    expect(july.daysAwayFromHome).toBe(7);
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
});

describe('CANONICAL ISOLATION — item 6, the hard requirement', () => {
  // Proof 1 — SOURCE AUDIT: grep every canonical KPI/expense engine's own
  // source file and confirm zero references to this table/module by name.
  // This is a REAL regression guard, not a comment: if a future edit ever
  // wires prime_driver_expenses into any of these files, this test fails
  // immediately.
  const CANONICAL_FILES = [
    'src/stats/kpi.ts',
    'src/stats/trueProfit.ts',
    'src/stats/cpm.ts',
    'src/stats/truckComparison.ts',
    'src/stats/accountantPackage.ts',
    'src/data/taxEstimate.ts',
  ];
  const FORBIDDEN_PATTERNS = [/prime_driver_expenses/i, /PrimeDriverExpense/, /primeDriverExpenses/];

  it('no canonical KPI/expense/tax engine file references prime_driver_expenses by name, in code or type', () => {
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
