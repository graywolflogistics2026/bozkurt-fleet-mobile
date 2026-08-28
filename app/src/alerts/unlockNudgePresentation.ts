import type { NudgeCandidate, NudgeTopic } from '@/src/alerts/missingDataNudges';

// "UNLOCK" NUDGES (owner decision 2026-08-24, FIVE ADDITIONS pass PART 1)
// — the ONE shared presentation layer for every surface that shows one of
// these cards (Alerts screen's "Get more out of the app" section, Home's
// AI Coach one-line card) so icon/route/copy/time-estimate can never
// disagree between the two. Same "one shared function, never two copies"
// convention as periodicCoachNudges.ts's coachNudgeText().
export const NUDGE_ICON: Record<NudgeTopic, string> = {
  noRecentSettlement: '📥',
  settlementMissingMiles: '🛣️',
  truckCostBasisNotSet: '🚚',
  depreciationNotSet: '📉',
  needsReviewReceipts: '🧾',
  weeklyGoalNotSet: '🎯',
  complianceItemMissing: '🪪',
  entityTypeNotSet: '🏛️',
  homeStateNotSet: '📍',
  firstReceiptMissing: '🧾',
  perDiemZeroMileWeek: '🏠',
};

// A rough, honest estimate of how long entering the field actually takes —
// plain numbers, not user-facing text (the minute count is passed into a
// single shared, localized "~{{minutes}} min" string, see alerts.tsx/
// index.tsx's own t() calls) — never fabricated precision.
export const NUDGE_TIME_ESTIMATE_MINUTES: Record<NudgeTopic, number> = {
  noRecentSettlement: 3,
  settlementMissingMiles: 1,
  truckCostBasisNotSet: 2,
  depreciationNotSet: 1,
  needsReviewReceipts: 1,
  weeklyGoalNotSet: 1,
  complianceItemMissing: 1,
  entityTypeNotSet: 1,
  homeStateNotSet: 1,
  firstReceiptMissing: 2,
  perDiemZeroMileWeek: 1,
};

export const NUDGE_ROUTE: Record<NudgeTopic, string> = {
  noRecentSettlement: '/(tabs)/import',
  settlementMissingMiles: '/(tabs)/more/settlements',
  truckCostBasisNotSet: '/(tabs)/more/trucks',
  depreciationNotSet: '/(tabs)/more/trucks',
  needsReviewReceipts: '/(tabs)/deductions',
  weeklyGoalNotSet: '/(tabs)/more/ceo-mode',
  complianceItemMissing: '/(tabs)/more/compliance',
  entityTypeNotSet: '/(tabs)/more/tax-estimator',
  homeStateNotSet: '/(tabs)/more/settings',
  firstReceiptMissing: '/(tabs)/import',
  perDiemZeroMileWeek: '/(tabs)/more/settlements',
};

// Builds the i18n interpolation params for `alerts.nudges.${topic}` —
// centralized here so a new real-number field added to a detector's detail
// (missingDataNudges.ts) only needs formatting logic written once.
// `money`/`moneyRounded` are the caller's own formatter (src/i18n/format.ts)
// so every locale's currency formatting stays consistent with the rest of
// the app.
export function unlockNudgeParams(
  n: NudgeCandidate,
  moneyRounded: (amount: number) => string
): Record<string, string | number> {
  // `count`/`days` are only included when the detail actually HAS one —
  // i18next auto-applies plural-suffix resolution (_one/_other) to ANY key
  // called with a `count` param, even one that was never meant to
  // pluralize, so a topic with no real count (entityTypeNotSet,
  // homeStateNotSet, ...) must never receive a default `count: 0` here.
  const params: Record<string, string | number> = {};
  if (typeof n.detail.count === 'number') params.count = n.detail.count;
  if (typeof n.detail.days === 'number') params.days = n.detail.days;
  if (typeof n.detail.type === 'string') params.type = n.detail.type;
  if (typeof n.detail.suggested === 'number') params.suggested = moneyRounded(n.detail.suggested);
  if (typeof n.detail.currentCpm === 'number') params.currentCpm = `$${n.detail.currentCpm.toFixed(2)}`;
  if (typeof n.detail.previewTotal === 'number') params.previewTotal = moneyRounded(n.detail.previewTotal);
  if (typeof n.detail.potential === 'number') params.potential = moneyRounded(n.detail.potential);
  return params;
}

// The one shared sentence-builder — used by the Alerts screen's full card
// AND Home's AI Coach one-line card (app/(tabs)/index.tsx), so the two
// surfaces can never say something different about the same missing field.
export function unlockNudgeText(
  n: NudgeCandidate,
  t: (key: string, opts?: Record<string, unknown>) => string,
  moneyRounded: (amount: number) => string
): string {
  const params = unlockNudgeParams(n, moneyRounded);
  const hasAmount = !!(params.suggested || params.currentCpm || params.previewTotal || params.potential);
  if (n.topic === 'complianceItemMissing') {
    return t('alerts.nudges.complianceItemMissing', { ...params, typeLabel: t(`compliance.types.${params.type}`) });
  }
  if (
    (n.topic === 'depreciationNotSet' || n.topic === 'settlementMissingMiles' || n.topic === 'perDiemZeroMileWeek' || n.topic === 'weeklyGoalNotSet') &&
    hasAmount
  ) {
    return t(`alerts.nudges.${n.topic}_amount`, params);
  }
  return t(`alerts.nudges.${n.topic}`, params);
}
