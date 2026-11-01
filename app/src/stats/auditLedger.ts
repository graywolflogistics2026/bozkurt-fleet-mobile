import { reducesTrueProfit, resolveFuelRows, type CanonicalDeduction, type CanonicalFuel } from '@/src/stats/trueProfit';
import type { LedgerReason, StatementWeek } from '@/src/stats/statementRoute';

// AUDIT LEDGER (owner decision 2026-10-13, docs/decisions/prime-statement-source.md
// item 8). Every row behind a period's expense figure, each COUNTED,
// OFFSET or EXCLUDED with a reason — built from the SAME rows and rules
// computeKpis() uses, so Σ counted − Σ offset = expenses.total exactly.
// Feeds Home's Expenses explainer, the bridge's "Show every row" and
// "Share audit".

export type LedgerStatus = 'counted' | 'offset' | 'excluded';
export type LedgerSource = 'prime_statement' | 'settlement' | 'manual';

export type LedgerTable = 'statement' | 'deductions' | 'fuel_purchases' | 'maintenance_records' | 'tolls' | 'reimbursements';

export type LedgerRow = {
  key: string;
  // Batch D item 8: the row behind the line, so a screen can open it.
  table: LedgerTable;
  rowId: string | null;
  source: LedgerSource;
  settlementId: string | null;
  // The underlying deductions row id, when there is one (the explainer's
  // delete button only ever acts on a real deductions row).
  deductionId: string | null;
  date: string | null;
  label: string;
  category: string | null;
  status: LedgerStatus;
  // Always ≥ 0; the status says which way it moves expenses.
  amount: number;
  reason: LedgerReason;
};

type LedgerDeduction = CanonicalDeduction & { id?: string; ded_date?: string | null };
type LedgerFuel = CanonicalFuel & { id?: string; location?: string | null };
type LedgerMaintenance = { id?: string; cost: number | null; description?: string | null; service_type?: string | null; service_date?: string | null; settlement_id?: string | null };
type LedgerToll = { id?: string; amount: number | null; plaza?: string | null; toll_date?: string | null; settlement_id?: string | null };
type LedgerReimbursement = { id?: string; amount: number | null; description?: string | null; reimb_date?: string | null; settlement_id?: string | null };

function excludedReasonFor(category: string | null | undefined): LedgerReason {
  if (category === 'Advance Repayment') return 'advance';
  if (category === 'Escrow & Deposits') return 'escrow';
  if (category === 'Meals (per diem covered)') return 'meals_per_diem';
  return 'non_deductible';
}

const sourceOf = (settlementId: string | null | undefined): LedgerSource => (settlementId ? 'settlement' : 'manual');

export function buildAuditLedger(
  statementWeeks: StatementWeek[],
  deductions: LedgerDeduction[],
  fuelPurchases: LedgerFuel[],
  maintenanceRecords: LedgerMaintenance[],
  tolls: LedgerToll[],
  reimbursements: LedgerReimbursement[]
): LedgerRow[] {
  const rows: LedgerRow[] = [];

  for (const week of statementWeeks) {
    week.ledger.forEach((e, i) => {
      if (e.status === 'revenue') return;
      rows.push({
        key: `st-${week.settlementId}-${i}`,
        table: 'statement',
        rowId: null,
        source: 'prime_statement',
        settlementId: week.settlementId,
        deductionId: null,
        date: week.weekEnding,
        label: e.label,
        category: e.category,
        status: e.status,
        amount: e.status === 'excluded' ? Math.abs(e.printed) : Math.abs(e.contribution),
        reason: e.reason as LedgerReason,
      });
    });
  }

  deductions.forEach((d, i) => {
    const amount = Number(d.amount ?? 0);
    const base = {
      key: `ded-${d.id ?? i}`,
      table: 'deductions' as const,
      rowId: d.id ?? null,
      source: sourceOf(d.settlement_id),
      settlementId: d.settlement_id ?? null,
      deductionId: d.id ?? null,
      date: d.ded_date ?? null,
      label: d.description ?? d.category ?? '',
      category: d.category ?? null,
    };
    if (!reducesTrueProfit(d)) rows.push({ ...base, status: 'excluded', amount: Math.abs(amount), reason: excludedReasonFor(d.category) });
    else if (amount < 0) rows.push({ ...base, status: 'offset', amount: -amount, reason: 'discount_credit' });
    else rows.push({ ...base, status: 'counted', amount, reason: 'expense' });
  });

  const fuel = resolveFuelRows(fuelPurchases, deductions);
  fuel.counted.forEach(({ row, cost }, i) =>
    rows.push({
      key: `fuel-${row.id ?? i}`,
      table: 'fuel_purchases',
      rowId: row.id ?? null,
      source: sourceOf(row.settlement_id),
      settlementId: row.settlement_id ?? null,
      deductionId: null,
      date: row.purchase_date ?? null,
      label: row.location ?? `${row.fuel_type ?? ''} fuel`.trim(),
      category: 'Fuel & DEF',
      status: 'counted',
      amount: cost,
      reason: 'expense',
    })
  );
  fuel.skippedAsDuplicate.forEach((row, i) =>
    rows.push({
      key: `fuel-dup-${row.id ?? i}`,
      table: 'fuel_purchases',
      rowId: row.id ?? null,
      source: sourceOf(row.settlement_id),
      settlementId: row.settlement_id ?? null,
      deductionId: null,
      date: row.purchase_date ?? null,
      label: row.location ?? `${row.fuel_type ?? ''} fuel`.trim(),
      category: 'Fuel & DEF',
      status: 'excluded',
      amount: Number(row.amount ?? 0),
      reason: 'duplicate_fuel',
    })
  );

  maintenanceRecords.forEach((m, i) =>
    rows.push({
      key: `maint-${m.id ?? i}`,
      table: 'maintenance_records',
      rowId: m.id ?? null,
      source: sourceOf(m.settlement_id),
      settlementId: m.settlement_id ?? null,
      deductionId: null,
      date: m.service_date ?? null,
      label: m.description ?? m.service_type ?? '',
      category: 'Maintenance & Repairs',
      status: 'counted',
      amount: Number(m.cost ?? 0),
      reason: 'expense',
    })
  );
  tolls.forEach((t, i) =>
    rows.push({
      key: `toll-${t.id ?? i}`,
      table: 'tolls',
      rowId: t.id ?? null,
      source: sourceOf(t.settlement_id),
      settlementId: t.settlement_id ?? null,
      deductionId: null,
      date: t.toll_date ?? null,
      label: t.plaza ?? '',
      category: 'Tolls & Scales',
      status: 'counted',
      amount: Number(t.amount ?? 0),
      reason: 'expense',
    })
  );
  reimbursements.forEach((r, i) =>
    rows.push({
      key: `reimb-${r.id ?? i}`,
      table: 'reimbursements',
      rowId: r.id ?? null,
      source: sourceOf(r.settlement_id),
      settlementId: r.settlement_id ?? null,
      deductionId: null,
      date: r.reimb_date ?? null,
      label: r.description ?? '',
      category: null,
      status: 'offset',
      amount: Number(r.amount ?? 0),
      reason: 'reimbursement',
    })
  );

  return rows;
}

export function ledgerTotals(rows: LedgerRow[]): { counted: number; offset: number; excluded: number; expenses: number } {
  const sum = (status: LedgerStatus) => rows.filter((r) => r.status === status).reduce((s, r) => s + r.amount, 0);
  const counted = sum('counted');
  const offset = sum('offset');
  return { counted, offset, excluded: sum('excluded'), expenses: counted - offset };
}
