import type { TaxYearData } from '@/src/types/db';
import type { BracketTable, FilingStatus, StateTaxResult } from '@/src/tax/types';
import { calcFederalTax } from '@/src/tax/federalTax';

// state_tax.bracket entries SHOULD be a BracketTable (docs/SCHEMA.sql,
// PROMPTS.md Session 5) — the live 2026 row's CA entry is confirmed to be
// one (verified against the live row 2026-07-05, see docs/ADMIN_RUNBOOK.md).
// This guard is defensive for FUTURE years/states an admin seeds before
// finishing verification, not evidence of a current gap: never crash on a
// malformed bracket entry, just fall back to fallback_effective_rate like
// any other ungraduated state.
function isBracketTable(value: unknown): value is BracketTable {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (['single', 'mfj', 'hoh'] as FilingStatus[]).every((k) => Array.isArray(v[k]));
}

// State comes from tax_config.state (default TX); include_state_tax lets
// the user omit the state line entirely (federal estimate is unaffected —
// PROMPTS.md Session 5).
export function calcStateTax(
  taxableIncome: number,
  state: string,
  includeStateTax: boolean,
  stateTax: TaxYearData['state_tax'],
  filingStatus: FilingStatus
): StateTaxResult {
  if (!includeStateTax || !state) return { amount: 0, label: 'none' };

  const code = state.toUpperCase();
  const base = Math.max(0, taxableIncome);

  if (stateTax.no_tax.includes(code)) {
    return { amount: 0, label: 'exact' };
  }

  if (code in stateTax.flat) {
    const rate = stateTax.flat[code];
    const adjustment = stateTax.flat_adjustments?.[code];
    // flat_adjustments is applied AFTER the base flat-rate result, never
    // folded into `flat` itself (docs/SCHEMA.sql, docs/ADMIN_RUNBOOK.md).
    let amount = base * rate;
    if (adjustment?.exempt_below !== undefined) {
      amount = Math.max(0, base - adjustment.exempt_below) * rate;
    }
    if (adjustment?.surtax_rate !== undefined && adjustment.surtax_over !== undefined) {
      const overThreshold = Math.max(0, base - adjustment.surtax_over);
      amount += overThreshold * adjustment.surtax_rate;
    }
    return { amount, label: 'exact' };
  }

  const bracketEntry = stateTax.bracket?.[code];
  if (isBracketTable(bracketEntry)) {
    const amount = calcFederalTax(base, filingStatus, bracketEntry);
    return { amount, label: 'exact' };
  }

  return { amount: base * stateTax.fallback_effective_rate, label: 'estimate' };
}
