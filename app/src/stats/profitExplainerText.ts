import type { ProfitExplanation } from '@/src/stats/profitExplainer';

// The profit explainer's words (batch D item 8) — one function for every
// surface, so the Home caption, the bridge sheet, a settlement's detail,
// the Settlements banner, the AI Coach review and the accountant notes
// can never phrase the same three numbers differently.
type T = (key: string, options?: Record<string, unknown>) => string;
export type ExplainerWhen = 'thisWeek' | 'lastWeek' | 'week' | 'period';

export function explanationSentence(e: ProfitExplanation, t: T, money: (n: number) => string, when: ExplainerWhen): string | null {
  const own =
    e.ownExpenses.count > 0
      ? t('profitExplainer.sentence', {
          count: e.ownExpenses.count,
          settlements: money(e.settlementsProfit),
          own: money(e.ownExpenses.total),
          profit: money(e.profit),
          when: t(`profitExplainer.when.${when}`),
        })
      : null;
  switch (e.case) {
    case 'unexplained':
      return t('profitExplainer.unexplained', { amount: money(Math.abs(e.residual)) });
    case 'extractionMismatch':
      return [t('profitExplainer.mismatch', { count: e.mismatchWeeks }), own].filter(Boolean).join(' ');
    case 'ownExpenses':
      return own;
    case 'primeMatch':
      return t('profitExplainer.primeMatch', { profit: money(e.profit) });
    default:
      return e.settlementsLabel ? t('profitExplainer.fromSettlements', { profit: money(e.profit) }) : null;
  }
}
