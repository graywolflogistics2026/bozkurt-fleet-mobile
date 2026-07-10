import type { TaxYearData } from '@/src/types/db';

export type FilingStatus = 'single' | 'mfj' | 'hoh';
// 'multi_member_llc' added retroactively (entity selection, owner decision
// 2026-07-10, docs/PENDING_SQL.md §18).
export type EntityType = 'sole_prop' | 'smllc' | 'multi_member_llc' | 'scorp';

// Shared shape for federal_brackets AND any per-state progressive bracket
// table (e.g. state_tax.bracket.CA) — both are [lowerBound, upperBoundOrNull, rate] tuples.
export type BracketTable = Record<FilingStatus, Array<[number, number | null, number]>>;

// Everything the tax engine needs beyond tax_year_data — CLAUDE.md invariant
// #6 forbids hardcoding any tax constant, but net profit / filing status /
// entity type are per-user inputs, not constants.
export type TaxEstimateInputs = {
  taxYearData: TaxYearData;
  filingStatus: FilingStatus;
  state: string;
  includeStateTax: boolean;
  entityType: EntityType;
  scorpSalary: number | null;
  // scorp only: owner-attested "my payroll provider already handles employer
  // FICA" — when true, the engine does NOT estimate employerPayrollTax
  // itself (avoids double-counting whatever the provider already tracks).
  scorpPayrollTaxHandled?: boolean;
  // multi_member_llc only: this member's % share (0-100) of the LLC, used
  // to scope the estimate to their own K-1 share. Defaults to 100 (full
  // share) when omitted — ignored for every other entityType.
  ownershipPct?: number;
  netProfit: number; // rev - out-of-pocket expenses - per diem deduction
  spouseIncome?: number; // additive to AGI, legacy `ti-spouse` — 0 if unused
  sepContribution?: number; // legacy `ti-sep` — 0 if unused
  healthInsurancePremiums?: number; // legacy `ti-hlt` — 0 if unused
};

export type StateTaxLabel = 'none' | 'exact' | 'estimate';

export type StateTaxResult = {
  amount: number;
  label: StateTaxLabel;
};

export type TaxEstimateResult = {
  netProfit: number; // full net profit before any entity-specific scoping
  // netProfit scoped by ownershipPct (multi_member_llc) or reduced by
  // employerPayrollTax (scorp) — equal to netProfit for sole_prop/smllc.
  // This is what AGI/effectiveRate are actually computed against.
  ownerShareOfProfit: number;
  // scorp only: estimated employer-side FICA cost of scorp_salary, a real
  // cash business expense — 0 for every other entityType, or when
  // scorpPayrollTaxHandled is true (provider already accounts for it).
  employerPayrollTax: number;
  seTaxBase: number; // the portion of net profit SE tax actually applies to
  seTax: number;
  seTaxDeduction: number; // half of seTax, deductible for AGI
  agi: number;
  standardDeduction: number;
  taxableIncome: number;
  federalTax: number;
  stateTax: StateTaxResult;
  totalTax: number;
  quarterlyPayment: number;
  weeklyTaxReserve: number;
  effectiveRate: number | null; // null when netProfit <= 0 (legacy shows '—')
};
