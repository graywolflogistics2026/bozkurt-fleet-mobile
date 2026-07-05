import { calcSeTax } from '@/src/tax/seTax';
import type { TaxYearData } from '@/src/types/db';

export type ScorpSavingsPreview = {
  currentSeTax: number;
  scorpSeTax: number;
  savings: number;
};

// PROMPTS.md Session 5: for sole_prop/smllc users only — given YTD net
// profit and an editable "reasonable salary" input, shows the SE tax
// they'd save electing S-Corp status. Educational/upsell only, never
// shown to entity_type='scorp' users (they've already made the election).
export function calcScorpSavingsPreview(
  netProfit: number,
  reasonableSalary: number,
  seTaxConfig: TaxYearData['se_tax']
): ScorpSavingsPreview {
  const np = Math.max(0, netProfit);
  const currentSeTax = calcSeTax(np, seTaxConfig).seTax;
  const scorpSeTax = calcSeTax(Math.min(Math.max(0, reasonableSalary), np), seTaxConfig).seTax;
  return { currentSeTax, scorpSeTax, savings: Math.max(0, currentSeTax - scorpSeTax) };
}
