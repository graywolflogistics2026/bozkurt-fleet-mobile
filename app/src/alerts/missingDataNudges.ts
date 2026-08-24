import { isOwnerRole, type ProfileRole } from '@/src/alerts/roleFilter';

// MISSING-DATA NUDGES (owner decision 2026-08-24, NEXT PASS item D2) —
// pure detection functions, each returning a candidate (with the real
// number it's based on) or null when nothing's missing. Deliberately take
// already-fetched minimal row shapes (Pick<...>) rather than full DB
// types, so these stay trivially unit-testable with plain fixture objects.
export type NudgeTopic = 'noRecentSettlement' | 'settlementMissingMiles' | 'truckCostBasisNotSet' | 'depreciationNotSet' | 'needsReviewReceipts';

export type NudgeCandidate = {
  topic: NudgeTopic;
  detail: Record<string, number>;
};

const NO_RECENT_SETTLEMENT_DAYS = 10;

// "No settlement imported for 10+ days" — an empty account (never imported
// anything at all) is an onboarding/empty-state concern, not a nudge; this
// only fires once there's a real settlement history to have gone quiet.
export function detectNoRecentSettlement(
  settlements: { week_ending: string }[],
  now: Date = new Date()
): NudgeCandidate | null {
  if (settlements.length === 0) return null;
  const latestWeekEnding = settlements.reduce((max, s) => (s.week_ending > max ? s.week_ending : max), settlements[0].week_ending);
  const daysSince = Math.floor((now.getTime() - new Date(`${latestWeekEnding}T00:00:00`).getTime()) / 86400000);
  return daysSince >= NO_RECENT_SETTLEMENT_DAYS ? { topic: 'noRecentSettlement', detail: { days: daysSince } } : null;
}

// A settlement with real revenue but no miles recorded — same "revenue
// exists, miles don't" signature CLAUDE.md's own settlement-reconciliation
// guard treats as suspicious, surfaced here as a friendly nudge to go add
// them (which also fixes CPM/RPM/per-diem for that week).
export function detectSettlementMissingMiles(settlements: { gross: number; miles: number | null }[]): NudgeCandidate | null {
  const count = settlements.filter((s) => s.gross > 0 && (!s.miles || s.miles <= 0)).length;
  return count > 0 ? { topic: 'settlementMissingMiles', detail: { count } } : null;
}

// Owners only (a company driver has no truck cost basis to set).
export function detectTruckCostBasisNotSet(
  trucks: { cost_basis_ownership_mode: string | null }[],
  role: ProfileRole
): NudgeCandidate | null {
  if (!isOwnerRole(role)) return null;
  const count = trucks.filter((t) => t.cost_basis_ownership_mode === null).length;
  return count > 0 ? { topic: 'truckCostBasisNotSet', detail: { count } } : null;
}

// Owners only, and only for a PURCHASED truck — a leased truck isn't
// depreciable at all (CLAUDE.md's depreciation-election invariant), so it
// never counts as "missing" here.
export function detectDepreciationNotSet(
  trucks: { cost_basis_ownership_mode: string | null; depreciation_method: string | null }[],
  role: ProfileRole
): NudgeCandidate | null {
  if (!isOwnerRole(role)) return null;
  const count = trucks.filter((t) => t.cost_basis_ownership_mode !== 'lease' && t.depreciation_method === null).length;
  return count > 0 ? { topic: 'depreciationNotSet', detail: { count } } : null;
}

// Same "NEEDS REVIEW: " prefix convention CLAUDE.md invariants #3/#14
// already establish — counting the prefix directly is simpler and just as
// accurate as re-deriving confidence.
export function detectNeedsReviewReceipts(deductions: { description: string | null }[]): NudgeCandidate | null {
  const count = deductions.filter((d) => (d.description ?? '').startsWith('NEEDS REVIEW:')).length;
  return count > 0 ? { topic: 'needsReviewReceipts', detail: { count } } : null;
}

export function buildMissingDataNudgeCandidates(input: {
  settlements: { week_ending: string; gross: number; miles: number | null }[];
  trucks: { cost_basis_ownership_mode: string | null; depreciation_method: string | null }[];
  deductions: { description: string | null }[];
  role: ProfileRole;
  now?: Date;
}): NudgeCandidate[] {
  const now = input.now ?? new Date();
  return [
    detectNoRecentSettlement(input.settlements, now),
    detectSettlementMissingMiles(input.settlements),
    detectTruckCostBasisNotSet(input.trucks, input.role),
    detectDepreciationNotSet(input.trucks, input.role),
    detectNeedsReviewReceipts(input.deductions),
  ].filter((c): c is NudgeCandidate => c !== null);
}
