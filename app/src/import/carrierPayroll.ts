// CARRIER PAYROLL DRIVERS (owner decision 2026-11-13, §88,
// docs/decisions/driver-carrier-payroll.md). A Prime week with a WAGE
// EXPENSE section pays a W-2 driver through Prime's payroll:
//
//   DF  F.I.C.A. FOR            BOZKME   54.99   -> employer taxes
//   DU  F.U.T.A. / S.U.T.A. FOR BOZKME    5.74   -> employer taxes
//   WC  WORK COMP COST          BOZKME   79.66   -> work comp
//   WD  WAGES PAID FOR          BOZKME  663.87   -> wages
//   2S  Emp Driver Wellness Bnf BOZKME    1.24   -> wages
//                       TOTAL WAGE EXPENSE 805.50 -> total
//
// ATTRIBUTION ONLY: these lines are already a real expense of the week
// (class WAGES, inside the statement's profit). The driver_payments row
// built here only says WHO the money went to; it is never counted again
// (isCarrierPayrollPayment() keeps it out of the tax estimate and the
// per-truck view).
//
// A driver is created ONLY from a code printed on a WAGE EXPENSE line,
// never from a fuel line (BOZKME is printed there too), never from the
// settlement's driverName. The name comes from the DRIVERS PAYROLL RECAP
// page ("EMPLOYEE: BOZKME MERVE BOZKURT"); without it the code is the
// name until the owner answers "Who is BOZKME?".
//
// Carrier-scoped: Prime Inc only (carrier isolation). Another carrier
// returns null — its wage section means nothing here yet.

import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';
import { normalizeCarrierKey } from '@/src/import/carrierCodes';
import type { Extraction } from '@/src/import/types';

type Settlement = NonNullable<Extraction['settlement']>;

export type CarrierPayrollDriver = {
  code: string;
  // As printed on the payroll recap; null when it was not read.
  name: string | null;
  wages: number;
  employerTaxes: number;
  workComp: number;
  // The printed TOTAL WAGE EXPENSE when the week has one driver, else the
  // sum of this driver's lines. A line-sum difference never blocks.
  total: number;
};

export type CarrierPayrollWeek = {
  carrier: string; // normalized key, e.g. "PRIME INC"
  teamWeek: boolean;
  drivers: CarrierPayrollDriver[];
};

const WAGE_PART: Record<string, 'wages' | 'employerTaxes' | 'workComp'> = {
  WD: 'wages',
  '2S': 'wages',
  DF: 'employerTaxes',
  DU: 'employerTaxes',
  WC: 'workComp',
};

// Words a wage description ends with when the code is NOT printed after it
// ("WAGES PAID FOR", "WORK COMP COST", "Emp Driver Wellness Bnf").
const NOT_A_CODE = new Set(['FOR', 'COST', 'PAID', 'BNF', 'TAX', 'TAXES', 'WAGE', 'WAGES', 'COMP', 'PAY', 'FEE', 'WELLNESS', 'DRIVER']);

const r2 = (n: number) => Math.round(n * 100) / 100;

// The driver code printed at the end of a wage line's description, or null.
export function wageLineDriverCode(description: string | null | undefined): string | null {
  const tokens = (description ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1];
  if (!/^[A-Z][A-Z0-9]{2,9}$/.test(last) || NOT_A_CODE.has(last)) return null;
  return last;
}

// "+ TEAM" printed on a revenue line: a team week (label only).
export function isTeamWeek(s: Settlement): boolean {
  return (s.revenueItems ?? []).some((r) => /\+\s*TEAM\b/i.test(r.desc ?? ''));
}

export function carrierPayrollOf(extraction: Extraction): CarrierPayrollWeek | null {
  const s = extraction.settlement;
  if (extraction.docType !== 'settlement' || !s || !isPrimeCarrier(s.carrier)) return null;
  const lines = (s.wageItems ?? []).map((w) => ({ code: (w.code ?? '').trim().toUpperCase(), driver: wageLineDriverCode(w.desc), amount: Number(w.amount) || 0 }));
  // A driver exists only where a WAGES PAID line (WD) names one.
  const codes = [...new Set(lines.filter((l) => l.code === 'WD' && l.driver).map((l) => l.driver as string))];
  if (codes.length === 0) return null;
  const owner = (l: (typeof lines)[number]) => (l.driver && codes.includes(l.driver) ? l.driver : codes.length === 1 ? codes[0] : null);
  const names = new Map((s.payrollEmployees ?? []).map((e) => [e.code.trim().toUpperCase(), e.name.trim()]));
  const printedTotal = typeof s.totalWageExpense === 'number' && Number.isFinite(s.totalWageExpense) && s.totalWageExpense > 0 ? s.totalWageExpense : null;
  const drivers = codes.map((code) => {
    const mine = lines.filter((l) => owner(l) === code);
    const part = (p: 'wages' | 'employerTaxes' | 'workComp') => r2(mine.filter((l) => WAGE_PART[l.code] === p).reduce((sum, l) => sum + l.amount, 0));
    const lineSum = r2(mine.reduce((sum, l) => sum + l.amount, 0));
    return {
      code,
      name: names.get(code) || null,
      wages: part('wages'),
      employerTaxes: part('employerTaxes'),
      workComp: part('workComp'),
      total: codes.length === 1 && printedTotal != null ? r2(printedTotal) : lineSum,
    };
  });
  return { carrier: normalizeCarrierKey(s.carrier) as string, teamWeek: isTeamWeek(s), drivers };
}

// A driver_payments row written from a carrier's payroll: attribution
// only, never a second expense (no tax deduction, no per-truck cost, no
// 1099 reminder, no app-computed FICA).
export function isCarrierPayrollPayment(p: object): boolean {
  return (p as { source?: unknown }).source === 'settlement';
}

// The short carrier name for the "W-2 via <carrier>" label.
export function carrierDisplayName(carrierKey: string | null | undefined): string {
  if (isPrimeCarrier(carrierKey)) return 'Prime';
  return (carrierKey ?? '').trim();
}

// "Who is BOZKME?" is open while the driver's name is still its code.
export function needsDriverName(d: { name: string; carrier_driver_code?: string | null }): boolean {
  const code = (d.carrier_driver_code ?? '').trim().toUpperCase();
  return !!code && d.name.trim().toUpperCase() === code;
}

export type PayrollTotals = { wages: number; employerTaxes: number; workComp: number; total: number };
export type CarrierPayrollSummary = {
  latest: (PayrollTotals & { date: string; settlementId: string | null }) | null;
  ytd: PayrollTotals;
  paidWeeks: number;
};

type PaymentLike = {
  driver_id: string;
  settlement_id: string | null;
  date: string;
  gross_pay: number | null;
  employer_taxes: number | null;
  work_comp?: number | null;
  total_cost?: number | null;
  source?: string | null;
};

const totalsOf = (p: PaymentLike): PayrollTotals => {
  const wages = Number(p.gross_pay ?? 0);
  const employerTaxes = Number(p.employer_taxes ?? 0);
  const workComp = Number(p.work_comp ?? 0);
  return { wages, employerTaxes, workComp, total: p.total_cost != null ? Number(p.total_cost) : wages + employerTaxes + workComp };
};

// The Drivers screen card: the latest paid week and the year to date of
// one carrier-payroll driver (the year of `todayIso`).
export function carrierPayrollSummary(payments: PaymentLike[], driverId: string, todayIso: string): CarrierPayrollSummary {
  const mine = payments.filter((p) => p.driver_id === driverId && isCarrierPayrollPayment(p)).sort((a, b) => b.date.localeCompare(a.date));
  const year = todayIso.slice(0, 4);
  const thisYear = mine.filter((p) => p.date.startsWith(year));
  const ytd = thisYear.reduce<PayrollTotals>(
    (acc, p) => {
      const t = totalsOf(p);
      return { wages: r2(acc.wages + t.wages), employerTaxes: r2(acc.employerTaxes + t.employerTaxes), workComp: r2(acc.workComp + t.workComp), total: r2(acc.total + t.total) };
    },
    { wages: 0, employerTaxes: 0, workComp: 0, total: 0 }
  );
  const latest = mine[0] ? { ...totalsOf(mine[0]), date: mine[0].date, settlementId: mine[0].settlement_id } : null;
  return { latest, ytd, paidWeeks: new Set(thisYear.map((p) => p.date)).size };
}
