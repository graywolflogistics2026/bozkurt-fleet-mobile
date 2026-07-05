import { calcFederalTax } from '@/src/tax/federalTax';
import { calcSeTax } from '@/src/tax/seTax';
import { calcStateTax } from '@/src/tax/stateTax';
import type { TaxEstimateInputs, TaxEstimateResult } from '@/src/tax/types';

// Orchestrates the whole estimate. Federal/SE math is a verbatim port of
// legacy calcTax() (legacy/index.html:2360):
//   const np=Math.max(0,rev-exp), seb=np*.9235, set=seb*.153, sed=set*.5;
//   const agi=Math.max(0,np+spouse-sed-sep-hlt);
//   const std=... ; const tax=Math.max(0,agi-std); ...bracket loop...
//   const tot=set+fed, qtr=tot/4;
// with two additions per PROMPTS.md Session 5: a state-tax line (legacy had
// none at all), and the entity_type branch (D8) — 'sole_prop'/'smllc' are
// the exact legacy computation; 'scorp' applies SE tax only to
// scorp_salary, with the remainder flowing through as SE-tax-free
// distributions. Federal/state brackets still apply to TOTAL net profit
// either way — only the SE-tax base differs.
export function calcTaxEstimate(inputs: TaxEstimateInputs): TaxEstimateResult {
  const {
    taxYearData,
    filingStatus,
    state,
    includeStateTax,
    entityType,
    scorpSalary,
    netProfit,
    spouseIncome = 0,
    sepContribution = 0,
    healthInsurancePremiums = 0,
  } = inputs;

  const np = Math.max(0, netProfit);
  const seTaxBase = entityType === 'scorp' ? Math.min(Math.max(0, scorpSalary ?? 0), np) : np;
  const { seTax, seTaxDeduction } = calcSeTax(seTaxBase, taxYearData.se_tax);

  const agi = Math.max(0, np + spouseIncome - seTaxDeduction - sepContribution - healthInsurancePremiums);
  const standardDeduction = taxYearData.standard_deduction[filingStatus];
  const taxableIncome = Math.max(0, agi - standardDeduction);

  const federalTax = calcFederalTax(taxableIncome, filingStatus, taxYearData.federal_brackets);
  const stateTax = calcStateTax(taxableIncome, state, includeStateTax, taxYearData.state_tax, filingStatus);

  const totalTax = seTax + federalTax + stateTax.amount;

  return {
    netProfit: np,
    seTaxBase,
    seTax,
    seTaxDeduction,
    agi,
    standardDeduction,
    taxableIncome,
    federalTax,
    stateTax,
    totalTax,
    quarterlyPayment: totalTax / 4,
    weeklyTaxReserve: totalTax / 52,
    effectiveRate: np > 0 ? (totalTax / np) * 100 : null,
  };
}
