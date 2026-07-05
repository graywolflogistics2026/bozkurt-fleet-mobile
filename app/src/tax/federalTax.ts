import type { BracketTable, FilingStatus } from '@/src/tax/types';

// Verbatim port of legacy calcTax()'s bracket loop (legacy/index.html:2360):
//   let fed=0; for(const[lo,hi,r] of brk){ if(tax<=lo)break; const ch=Math.min(tax,hi)-lo; fed+=ch*r; }
// `hi` of `null` (legacy used `1/0` = Infinity) means "no upper bound" — the
// top bracket. Brackets always come from tax_year_data, never hardcoded
// here (CLAUDE.md invariant #6).
//
// legacy also uses the SAME bracket array for 'single' and 'hoh' — that is
// NOT a bug to fix, it's how the 2026 data was seeded (see CLAUDE.md and
// docs/SCHEMA.sql). This function just reads whichever array the caller
// resolved for the filing status; it doesn't special-case hoh vs single
// itself, so the "shared table" behavior falls out of federal_brackets.hoh
// and federal_brackets.single being seeded identically.
export function calcFederalTax(taxableIncome: number, filingStatus: FilingStatus, brackets: BracketTable): number {
  const brk = brackets[filingStatus];
  let fed = 0;
  for (const [lo, hi, rate] of brk) {
    if (taxableIncome <= lo) break;
    const upper = hi === null ? Infinity : hi;
    const chunk = Math.min(taxableIncome, upper) - lo;
    fed += chunk * rate;
  }
  return fed;
}
