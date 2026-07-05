export type CapitalAccountSummary = {
  effectiveContribution: number;
  totalDraws: number;
  taxFreeRemaining: number;
};

// Verbatim port of legacy rCapital() (legacy/index.html:1380-1384):
//   const effectiveContribution=CAPITAL.contribution+totalContrib;
//   const capRemain=effectiveContribution-totalDraws;
// Display clamps capRemain at 0 (legacy: Math.max(0,capRemain)); the
// unclamped sign still matters for the red/green color, so callers that
// need that should compare effectiveContribution-totalDraws themselves.
export function calcCapitalAccount(
  initialCapital: number,
  totalContributions: number,
  totalDraws: number
): CapitalAccountSummary {
  const effectiveContribution = initialCapital + totalContributions;
  return {
    effectiveContribution,
    totalDraws,
    taxFreeRemaining: Math.max(0, effectiveContribution - totalDraws),
  };
}
