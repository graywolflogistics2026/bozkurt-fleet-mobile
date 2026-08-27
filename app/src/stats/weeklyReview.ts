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

// AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix (owner
// decision, docs/PENDING_SQL.md §65). The cache used to track only WHICH
// SETTLEMENT WEEK the text covers, never which LANGUAGE it was generated
// in — switching the app's language never invalidated a review generated
// under the old one, so a user who'd already gotten one English review
// before ever picking e.g. Turkish kept seeing that same English text
// forever. `cachedLocale`/`currentLocale` are the new inputs that close
// this gap: a mismatch is treated as a reason to regenerate immediately,
// on par with a genuinely new settlement week, and — deliberately —
// BYPASSES the 7-day cooldown below (a language switch is a rare,
// deliberate user action, not something worth rate-limiting the same way
// as "yet another settlement imported this week" is).
export function shouldGenerateWeeklyReview(
  cachedWeekEnding: string | null,
  cachedGeneratedAt: string | null,
  cachedLocale: string | null,
  latestWeekEnding: string | null,
  currentLocale: string,
  now: Date = new Date()
): boolean {
  if (!latestWeekEnding) return false; // nothing imported yet — nothing to review
  const sameWeek = latestWeekEnding === cachedWeekEnding;
  const localeMatches = cachedLocale === currentLocale;
  if (sameWeek && localeMatches) return false; // already reviewed this exact week, in this exact language
  if (!cachedGeneratedAt) return true; // never generated one before
  if (!localeMatches) return true; // language switch — always regenerate now, cooldown doesn't apply
  const sinceLastMs = now.getTime() - new Date(cachedGeneratedAt).getTime();
  return sinceLastMs >= REGENERATE_COOLDOWN_MS;
}

// A cached review is only safe to SHOW when it was tagged as generated
// for the locale currently active — anything else (never generated, or
// generated under a different language) must not be displayed, even
// while a fresh regeneration request is in flight. Extracted as its own
// tiny predicate (rather than inlined at each call site) so the "what
// makes a cached review trustworthy" rule lives in exactly one place.
export function isCachedReviewUsable(cachedReview: string | null, cachedLocale: string | null, currentLocale: string): boolean {
  return !!cachedReview && cachedLocale === currentLocale;
}

// SECOND LAYER OF DEFENSE, for the two non-Latin-script enabled locales
// (Russian/Cyrillic, Hindi/Devanagari) specifically: the locale TAG above
// protects against a STALE cache (correctly generated once, now outdated
// after a language switch) but cannot catch the case where the CURRENTLY
// DEPLOYED ai-advisor function simply doesn't honor the locale it's sent
// (e.g. mid-rollout, or a blocked/delayed redeploy) — the client tagged
// the response with the locale it REQUESTED, not what the model actually
// returned. For es/tr (Latin script, same alphabet English uses) there is
// no cheap, reliable way to distinguish "real Spanish/Turkish" from
// "English" by script alone, so this check is deliberately scoped to only
// the two scripts where it's unambiguous: a real Russian/Hindi response of
// any real length will always contain at least one character in its own
// script; a response with ZERO such characters is essentially certain to
// be the wrong language, not a false positive.
const SCRIPT_RANGES: Partial<Record<string, [number, number]>> = {
  ru: [0x0400, 0x04ff], // Cyrillic
  hi: [0x0900, 0x097f], // Devanagari
};

export function looksLikeExpectedScript(text: string, locale: string): boolean {
  const range = SCRIPT_RANGES[locale];
  if (!range) return true; // no reliable script check for this locale — don't flag it
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= range[0] && code <= range[1]) return true;
  }
  return false;
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
  // WEEKLY GOAL DRIVES THE COACH (owner decision 2026-08-24, FIVE
  // ADDITIONS pass, PART 3 item 1) — optional: omitted entirely when the
  // user hasn't set a weekly goal yet (Part 3 item 3 — "no goal set -> the
  // Part 1 unlock nudge explains what it unlocks; the coach starts using
  // it immediately once entered"), never a placeholder $0 goal.
  goalProgress?: {
    weeklyGoal: number;
    progressDollars: number;
    progressPct: number;
    metGoal: boolean;
    gapDollars: number;
    milesToCloseGap: number | null;
    loadsToCloseGap: number | null;
  } | null;
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
    // PART 3 item 1: "states goal progress in dollars and percent, and when
    // short, what would close the gap in the user's own terms (miles at
    // their current RPM, or one load at their average revenue per load).
    // Real figures only." — every clause below is a real, already-computed
    // number the caller passed in; nothing here is invented.
    inputs.goalProgress
      ? [
          `Weekly profit goal: ${money(inputs.goalProgress.weeklyGoal)} — this week is at ${money(inputs.goalProgress.progressDollars)} (${inputs.goalProgress.progressPct.toFixed(0)}% of goal).`,
          inputs.goalProgress.metGoal
            ? 'The goal was met or beaten this week.'
            : [
                `Short of the goal by ${money(inputs.goalProgress.gapDollars)}.`,
                inputs.goalProgress.milesToCloseGap != null
                  ? `That gap is about ${Math.round(inputs.goalProgress.milesToCloseGap)} more miles at this week's own rate per mile.`
                  : '',
                inputs.goalProgress.loadsToCloseGap != null
                  ? `Or roughly ${Math.ceil(inputs.goalProgress.loadsToCloseGap)} more load(s) at the average revenue per load.`
                  : '',
              ]
                .filter(Boolean)
                .join(' '),
        ]
          .filter(Boolean)
          .join(' ')
      : '',
    'Cite the numbers above directly. Never invent a figure that was not given here. Keep it upbeat but honest.',
  ].filter(Boolean);

  return parts.join(' ');
}

// FALLBACK WHILE THE REDEPLOY IS BLOCKED (owner decision, AI COACH TEXT IS
// ENGLISH IN EVERY LANGUAGE fix, item 4) — a deterministic, GUARANTEED-
// correctly-localized counterpart to buildWeeklyReviewPrompt() above,
// composed entirely from i18n `t()` calls over the exact same real inputs
// instead of a free-text AI response. This is what src/data/
// proactiveCoach.ts shows whenever the cached AI review isn't safe to
// trust (never generated yet, generated under a different locale, or —
// for ru/hi — failed the script sanity check) so the user is never
// looking at raw untranslated server text; same "plain i18n template
// instead of a second AI call" pattern this app already uses for
// periodic coach nudges (src/alerts/periodicCoachNudges.ts's
// coachNudgeText()). `money`/`pct` are injected formatters (same DI
// pattern aiRecommendations.ts's recommendationText() uses) so this stays
// a pure function with no Intl/component dependency of its own — the
// caller supplies real locale-aware formatters via useFormatters().
export function buildWeeklyReviewFallbackText(
  inputs: WeeklyReviewInputs,
  t: (key: string, opts?: Record<string, unknown>) => string,
  money: (n: number) => string,
  pct: (n: number) => string
): string {
  const parts = [
    t('ceoMode.weeklyReviewFallback.intro', { date: inputs.weekEnding, gross: money(inputs.gross), net: money(inputs.net) }),
    inputs.rpm != null
      ? inputs.trailingAvgRpm != null
        ? t('ceoMode.weeklyReviewFallback.rpmVsAvg', { rpm: money(inputs.rpm), avg: money(inputs.trailingAvgRpm) })
        : t('ceoMode.weeklyReviewFallback.rpm', { rpm: money(inputs.rpm) })
      : '',
    inputs.deadheadPct != null ? t('ceoMode.weeklyReviewFallback.deadhead', { pct: pct(inputs.deadheadPct) }) : '',
    inputs.fuelPctOfRevenue != null ? t('ceoMode.weeklyReviewFallback.fuel', { pct: pct(inputs.fuelPctOfRevenue) }) : '',
    inputs.perDiemDays > 0 ? t('ceoMode.weeklyReviewFallback.perDiem', { count: inputs.perDiemDays }) : '',
    t('ceoMode.weeklyReviewFallback.ytd', { amount: money(inputs.ytdProfitAfter) }),
    inputs.goalProgress
      ? inputs.goalProgress.metGoal
        ? t('ceoMode.weeklyReviewFallback.goalMet', { goal: money(inputs.goalProgress.weeklyGoal) })
        : t('ceoMode.weeklyReviewFallback.goalShort', {
            amount: money(inputs.goalProgress.gapDollars),
            goal: money(inputs.goalProgress.weeklyGoal),
          })
      : '',
  ].filter(Boolean);

  return parts.join(' ');
}
