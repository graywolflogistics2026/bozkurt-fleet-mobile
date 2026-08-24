// AI COACH — PROACTIVE WEEKLY REVIEW (owner decision 2026-08-24, NEXT PASS
// item E1). Two pure, testable pieces:
//   1. shouldGenerateWeeklyReview() — the caching/trigger decision (a new
//      settlement's own week_ending differs from the cached one, AND at
//      least 7 days since the last call — "costs one ai-advisor call per
//      user per week at most," the spec's own explicit cap).
//   2. buildWeeklyReviewPrompt() — composes the rich, data-filled prompt
//      text sent to ai-advisor as a single 'user' message, same
//      established pattern as ceo-mode.tsx's own handleGetBriefing()
//      (compose client-side from real numbers, no server-side prompt
//      change needed). Every figure is a real, already-computed number —
//      the instruction line explicitly forbids inventing anything else.
// The actual async ai-advisor call + cache read/write lives in
// src/data/weeklyReview.ts (a React hook), not here — this file has zero
// I/O so it can be tested with plain fixture objects.

const REGENERATE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldGenerateWeeklyReview(
  cachedWeekEnding: string | null,
  cachedGeneratedAt: string | null,
  latestWeekEnding: string | null,
  now: Date = new Date()
): boolean {
  if (!latestWeekEnding) return false; // nothing imported yet — nothing to review
  if (latestWeekEnding === cachedWeekEnding) return false; // already reviewed this exact week
  if (!cachedGeneratedAt) return true; // never generated one before
  const sinceLastMs = now.getTime() - new Date(cachedGeneratedAt).getTime();
  return sinceLastMs >= REGENERATE_COOLDOWN_MS;
}

export type WeeklyReviewInputs = {
  weekEnding: string;
  gross: number;
  net: number;
  rpm: number | null; // this week's own revenue/loaded-mile
  trailingAvgRpm: number | null; // the user's own trailing average, for comparison
  deadheadPct: number | null; // 0-1, null when no mileage data at all
  fuelPctOfRevenue: number | null; // 0-1
  biggestChargebacks: { description: string; amount: number }[]; // already sorted desc, caller caps the length
  perDiemDays: number; // 0-7
  ytdProfitBefore: number;
  ytdProfitAfter: number;
};

// Composes ONE 'user' message for callAiAdvisor(), mirroring
// ceo-mode.tsx's handleGetBriefing() prompt-building style exactly (plain
// English sentences built from real numbers, filtered for blanks, joined
// with spaces) so the two AI-composed surfaces in this app read
// consistently to the model.
export function buildWeeklyReviewPrompt(inputs: WeeklyReviewInputs): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const parts = [
    `Give a short weekly settlement review for the week ending ${inputs.weekEnding} — 2-3 sentences, then up to 3 short, concrete action items.`,
    `Revenue: ${money(inputs.gross)}, Net: ${money(inputs.net)}.`,
    inputs.rpm != null
      ? `Rate per mile this week: ${money(inputs.rpm)}/mi${inputs.trailingAvgRpm != null ? `, vs your own trailing average of ${money(inputs.trailingAvgRpm)}/mi` : ''}.`
      : '',
    inputs.deadheadPct != null ? `Deadhead: ${pct(inputs.deadheadPct)} of miles.` : '',
    inputs.fuelPctOfRevenue != null ? `Fuel was ${pct(inputs.fuelPctOfRevenue)} of revenue.` : '',
    inputs.biggestChargebacks.length > 0
      ? `Biggest settlement chargebacks: ${inputs.biggestChargebacks.map((c) => `${c.description} (${money(c.amount)})`).join(', ')}.`
      : 'No large settlement chargebacks this week.',
    `Per diem days this week: ${inputs.perDiemDays}.`,
    `Year-to-date net profit moved from ${money(inputs.ytdProfitBefore)} to ${money(inputs.ytdProfitAfter)} with this week included.`,
    'Cite the numbers above directly. Never invent a figure that was not given here. Keep it upbeat but honest.',
  ].filter(Boolean);

  return parts.join(' ');
}
