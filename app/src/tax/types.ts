import type { TaxYearData } from '@/src/types/db';

export type FilingStatus = 'single' | 'mfj' | 'hoh';
export type EntityType = 'sole_prop' | 'smllc' | 'scorp';

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
  netProfit: number;
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
