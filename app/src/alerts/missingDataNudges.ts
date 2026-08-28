import { isOwnerRole, type ProfileRole } from '@/src/alerts/roleFilter';
import type { ComplianceType } from '@/src/compliance/status';
import { isDeductionNeedsReview } from '@/src/import/needsReview';

// MISSING-DATA NUDGES (owner decision 2026-08-24, NEXT PASS item D2;
// extended 2026-08-24 FIVE ADDITIONS pass item 1 — "UNLOCK" NUDGES) — pure
// detection functions, each returning a candidate (with the real number
// it's based on, whenever one exists) or null when nothing's missing.
// Deliberately take already-fetched minimal row shapes (Pick<...>) rather
// than full DB types, so these stay trivially unit-testable with plain
// fixture objects. Every NEW field buildMissingDataNudgeCandidates() takes
// below is OPTIONAL and OMITTED-means-"unknown, don't nudge" (not the same
// as an explicit null/0) — this is what keeps the original 5 detectors'
// existing call sites/tests compiling and behaving identically without
// having to thread every new field through them.
export type NudgeTopic =
  | 'noRecentSettlement'
  | 'settlementMissingMiles'
  | 'truckCostBasisNotSet'
  | 'depreciationNotSet'
  | 'needsReviewReceipts'
  | 'weeklyGoalNotSet'
  | 'complianceItemMissing'
  | 'entityTypeNotSet'
  | 'homeStateNotSet'
  | 'firstReceiptMissing'
  | 'perDiemZeroMileWeek';

export type NudgeCandidate = {
  topic: NudgeTopic;
  detail: Record<string, number | string>;
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
// them (which also fixes CPM/RPM/per-diem for that week). "UNLOCK" NUDGES
// (2026-08-24 FIVE ADDITIONS pass) — an optional `currentCpm` names the
// real, already-computed cost/mile figure that's artificially inflated by
// the missing-miles denominator, so the nudge can say exactly what will
// drop once it's fixed rather than a generic "add your miles."
export function detectSettlementMissingMiles(
  settlements: { gross: number; miles: number | null }[],
  currentCpm?: number | null
): NudgeCandidate | null {
  const count = settlements.filter((s) => s.gross > 0 && (!s.miles || s.miles <= 0)).length;
  if (count === 0) return null;
  const detail: Record<string, number> = { count };
  if (currentCpm != null && currentCpm > 0) detail.currentCpm = Math.round(currentCpm * 100) / 100;
  return { topic: 'settlementMissingMiles', detail };
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
// never counts as "missing" here. "UNLOCK" NUDGES (2026-08-24 FIVE
// ADDITIONS pass) — an optional `previewTotal` is the real dollar amount
// the caller already computed (src/tax/depreciation.ts's
// calcCurrentYearDepreciation with method:'full', the "up to" maximum
// deduction) from the purchase price already on file — a real, non-
// fabricated number, never shown unless the caller actually computed it.
export function detectDepreciationNotSet(
  trucks: { cost_basis_ownership_mode: string | null; depreciation_method: string | null }[],
  role: ProfileRole,
  previewTotal?: number | null
): NudgeCandidate | null {
  if (!isOwnerRole(role)) return null;
  const count = trucks.filter((t) => t.cost_basis_ownership_mode !== 'lease' && t.depreciation_method === null).length;
  if (count === 0) return null;
  const detail: Record<string, number> = { count };
  if (previewTotal != null && previewTotal > 0) detail.previewTotal = Math.round(previewTotal);
  return { topic: 'depreciationNotSet', detail };
}

// Reads the ONE shared isDeductionNeedsReview() (src/import/
// needsReview.ts) rather than re-deriving its own copy of the "NEEDS
// REVIEW: " prefix check — a second, independent copy of this check is
// exactly what let a row the user had already marked reviewed keep
// nudging here even after clearing everywhere else (owner decision
// 2026-08-24, device testing round — the fix).
export function detectNeedsReviewReceipts(deductions: { description: string | null; reviewed_at: string | null }[]): NudgeCandidate | null {
  const count = deductions.filter(isDeductionNeedsReview).length;
  return count > 0 ? { topic: 'needsReviewReceipts', detail: { count } } : null;
}

// Universal (every role) — a goal is what turns the AI Coach from a
// dashboard into an actual coach; unlike the truck/tax topics below, this
// isn't gated to owners. `suggestedGoal` is the trailing-4-week net
// average (src/stats/goalProgress.ts's trailingAverageNet()) — the SAME
// number the goal-entry field itself prefills with (Part 3 item 4), so the
// nudge and the field never suggest two different starting points.
export function detectWeeklyGoalNotSet(weeklyGoal: number | null, suggestedGoal?: number | null): NudgeCandidate | null {
  if (weeklyGoal != null) return null;
  const detail: Record<string, number> = {};
  if (suggestedGoal != null && suggestedGoal > 0) detail.suggested = Math.round(suggestedGoal);
  return { topic: 'weeklyGoalNotSet', detail };
}

// medical card / CDL / HVUT / IRP "by role" (spec's own explicit list) —
// role-filtered via roleFilter.ts's isComplianceTypeVisibleForRole so a
// company driver is never asked for truck paperwork they don't own. Names
// ONE missing type at a time (first in this fixed order still missing),
// same "one small ask, not a checklist" pattern as periodicCoachNudges.ts's
// detectMissingCommonCategory — a compliance_items row existing at all
// (regardless of due date) counts as "not missing" here; a due-soon/
// overdue existing item is Alerts' own separate time-critical section, not
// this one.
export const UNLOCK_COMPLIANCE_CANDIDATES: ComplianceType[] = ['medical_card', 'cdl', 'hvut_2290', 'irp_registration'];

export function detectComplianceItemMissing(
  existingTypes: ComplianceType[],
  role: ProfileRole,
  isComplianceTypeVisibleForRole: (role: ProfileRole, type: ComplianceType) => boolean
): NudgeCandidate | null {
  const present = new Set(existingTypes);
  const missing = UNLOCK_COMPLIANCE_CANDIDATES.find((type) => isComplianceTypeVisibleForRole(role, type) && !present.has(type));
  return missing ? { topic: 'complianceItemMissing', detail: { type: missing } } : null;
}

// Owners only (CLAUDE.md invariant #18 — a company driver has no Schedule
// C / entity-type decision to make).
export function detectEntityTypeNotSet(entityTypeSet: boolean, role: ProfileRole): NudgeCandidate | null {
  if (!isOwnerRole(role)) return null;
  return entityTypeSet ? null : { topic: 'entityTypeNotSet', detail: {} };
}

// Universal — state tax accuracy matters even to a W-2 driver estimating
// their own withholding.
export function detectHomeStateNotSet(homeState: string | null): NudgeCandidate | null {
  return homeState ? null : { topic: 'homeStateNotSet', detail: {} };
}

// Owners only — the out-of-pocket report (Accountant Package) is a
// Schedule C concept.
export function detectFirstReceiptMissing(deductionsCount: number, role: ProfileRole): NudgeCandidate | null {
  if (!isOwnerRole(role)) return null;
  return deductionsCount === 0 ? { topic: 'firstReceiptMissing', detail: {} } : null;
}

// A 0-mile settlement week smart-defaults per_diem_days to 0 ("home week,"
// src/tax/perDiem.ts's defaultPerDiemDaysForMiles()) — usually correct,
// but a 0-mile week can still be a real day away from home (e.g. stuck at
// a shipper). Names the real potential deduction — up to 7 days × the
// server-sourced per diem daily rate (CLAUDE.md invariant #6: never
// hardcode this rate; the caller passes it from tax_year_data via
// useTaxEstimate) — summed across every such week, so the number is real
// and computable, never fabricated. Owners only (per diem is a Schedule C/
// self-employment concept for this app, same per_diem_days field a
// company driver's account never populates).
export function detectPerDiemZeroMileWeek(
  settlements: { miles: number; per_diem_days: number | null }[],
  role: ProfileRole,
  perDiemDailyRate?: number | null
): NudgeCandidate | null {
  if (!isOwnerRole(role)) return null;
  const count = settlements.filter((s) => (s.miles ?? 0) === 0 && (s.per_diem_days ?? 0) === 0).length;
  if (count === 0) return null;
  const detail: Record<string, number> = { count };
  if (perDiemDailyRate != null && perDiemDailyRate > 0) detail.potential = Math.round(count * 7 * perDiemDailyRate);
  return { topic: 'perDiemZeroMileWeek', detail };
}

export function buildMissingDataNudgeCandidates(input: {
  settlements: { week_ending: string; gross: number; miles: number | null; per_diem_days?: number | null }[];
  trucks: { cost_basis_ownership_mode: string | null; depreciation_method: string | null }[];
  deductions: { description: string | null; reviewed_at: string | null }[];
  role: ProfileRole;
  now?: Date;
  // "UNLOCK" NUDGES (2026-08-24 FIVE ADDITIONS pass item 1) — every field
  // below is OPTIONAL; omitting one means "the caller doesn't know yet,"
  // never "confirmed unset," so the matching detector is skipped rather
  // than firing on a false positive. See the file header comment.
  currentCpm?: number | null;
  depreciationPreviewTotal?: number | null;
  weeklyGoal?: number | null;
  suggestedWeeklyGoal?: number | null;
  existingComplianceTypes?: ComplianceType[];
  isComplianceTypeVisibleForRole?: (role: ProfileRole, type: ComplianceType) => boolean;
  entityTypeSet?: boolean;
  homeState?: string | null;
  deductionsCount?: number;
  perDiemDailyRate?: number | null;
  // Explicit opt-in — omitted settlement rows have no `per_diem_days` key
  // at all in the two existing callers' fixtures, and an omitted field
  // would otherwise read as `undefined ?? 0 === 0`, a false "0-mile,
  // 0-per-diem" positive. Only fires once the caller confirms the passed
  // settlements actually carry real per_diem_days values.
  checkPerDiemZeroMileWeek?: boolean;
}): NudgeCandidate[] {
  const now = input.now ?? new Date();
  return [
    detectNoRecentSettlement(input.settlements, now),
    detectSettlementMissingMiles(input.settlements, input.currentCpm),
    detectTruckCostBasisNotSet(input.trucks, input.role),
    detectDepreciationNotSet(input.trucks, input.role, input.depreciationPreviewTotal),
    detectNeedsReviewReceipts(input.deductions),
    input.weeklyGoal !== undefined ? detectWeeklyGoalNotSet(input.weeklyGoal, input.suggestedWeeklyGoal) : null,
    input.existingComplianceTypes !== undefined && input.isComplianceTypeVisibleForRole
      ? detectComplianceItemMissing(input.existingComplianceTypes, input.role, input.isComplianceTypeVisibleForRole)
      : null,
    input.entityTypeSet !== undefined ? detectEntityTypeNotSet(input.entityTypeSet, input.role) : null,
    input.homeState !== undefined ? detectHomeStateNotSet(input.homeState) : null,
    input.deductionsCount !== undefined ? detectFirstReceiptMissing(input.deductionsCount, input.role) : null,
    input.checkPerDiemZeroMileWeek
      ? detectPerDiemZeroMileWeek(
          input.settlements.map((s) => ({ miles: s.miles ?? 0, per_diem_days: s.per_diem_days ?? null })),
          input.role,
          input.perDiemDailyRate
        )
      : null,
  ].filter((c): c is NudgeCandidate => c !== null);
}
