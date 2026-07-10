import type { Driver, DriverPayment, TaxYearData } from '@/src/types/db';

// 1099-NEC filing threshold — a hardcoded fallback ONLY until
// docs/PENDING_SQL.md §17 has been run (same graceful-degradation pattern as
// the Dashboard's per_diem.full_daily_rate caption, CLAUDE.md invariant #6:
// this doesn't change any computed TAX AMOUNT, only whether/how the
// informational reminder banner renders). Once tax_year_data.nec_1099
// exists, that server-side value always wins.
const FALLBACK_NEC_THRESHOLD = 600;

export type ContractLaborYtd = {
  driverId: string;
  driverName: string;
  ytdTotal: number;
  needsNecReminder: boolean;
};

// Owner decision 2026-07-10 (driver compensation types, PRODUCT DECISION):
// 1099 payments are tracked per driver per tax year — cross $600 (or the
// server-configured threshold) and a "1099-NEC required at year-end"
// reminder surfaces on the Dashboard.
export function calcContractLaborYtd(
  payments: DriverPayment[],
  drivers: Driver[],
  taxYear: number,
  necConfig?: TaxYearData['nec_1099']
): ContractLaborYtd[] {
  const threshold = necConfig?.threshold ?? FALLBACK_NEC_THRESHOLD;
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const totals = new Map<string, number>();

  for (const p of payments) {
    const driver = driverById.get(p.driver_id);
    if (!driver || driver.compensation_type !== '1099_contractor') continue;
    if (!p.date.startsWith(String(taxYear))) continue;
    totals.set(p.driver_id, (totals.get(p.driver_id) ?? 0) + Number(p.gross_pay ?? 0));
  }

  return Array.from(totals.entries()).map(([driverId, ytdTotal]) => ({
    driverId,
    driverName: driverById.get(driverId)?.name ?? '',
    ytdTotal,
    needsNecReminder: ytdTotal >= threshold,
  }));
}

// Deductible business expense from ALL recorded driver payments, regardless
// of compensation_type — 1099 gross pay ("Contract Labor"), W-2 wages PLUS
// employer_taxes (true cost of employee), and team_split/trainee shares all
// reduce the owner's net profit the same way: the owner never owed tax on
// money that went to someone else. employer_taxes defaults to 0 for every
// compensation_type except w2_employee, which is what lets this stay a
// single uniform formula with no type-specific branch.
export function sumDeductibleDriverPayroll(payments: DriverPayment[]): number {
  return payments.reduce((sum, p) => sum + Number(p.gross_pay ?? 0) + Number(p.employer_taxes ?? 0), 0);
}

// "True cost of employee" — W-2 wages plus the employer-side payroll taxes
// paid on top of them, for display in a future driver-management screen
// (PROMPTS.md Session 8).
export function calcTrueCostOfEmployee(grossPay: number, employerTaxes: number): number {
  return grossPay + employerTaxes;
}

// W-2 employer_taxes to record on a new driver_payment at entry time —
// gross_pay × tax_year_data.se_tax.employer_fica (falls back to 0, i.e. no
// employer tax estimated, until docs/PENDING_SQL.md §17 has been run —
// never a hardcoded rate, per CLAUDE.md invariant #6).
export function calcW2EmployerTaxes(grossPay: number, employerFicaRate: number | undefined): number {
  return Math.max(0, grossPay) * (employerFicaRate ?? 0);
}
