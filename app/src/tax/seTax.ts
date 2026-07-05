import type { TaxYearData } from '@/src/types/db';

export type SeTaxResult = { seTax: number; seTaxDeduction: number };

// Verbatim port of legacy calcTax() (legacy/index.html:2360):
//   const seb=np*.9235, set=seb*.153, sed=set*.5;
// Applied UNCAPPED — legacy never applies the Social Security wage-base
// cutoff, so `se_tax.ss_wage_base` is read from tax_year_data for future
// use but NOT applied here (CLAUDE.md / docs/ADMIN_RUNBOOK.md: don't start
// applying the cap without an explicit, separate owner decision to do so).
//
// `base` is the amount SE tax actually applies to — the full net profit for
// sole_prop/smllc, or just scorp_salary for scorp (see calcTaxEstimate.ts).
export function calcSeTax(base: number, seTaxConfig: TaxYearData['se_tax']): SeTaxResult {
  const seBase = Math.max(0, base) * seTaxConfig.factor;
  const seTax = seBase * seTaxConfig.rate;
  const seTaxDeduction = seTax * 0.5;
  return { seTax, seTaxDeduction };
}
