import { findSavedWeeksNeedingDateCheck, type DateCheckReason } from '@/src/import/printedDates';
import { settlementVerification, type SettlementStatement } from '@/src/import/settlementStatement';
import type { StatementReviewReason } from '@/src/import/primeStatementLines';

// REVIEW THIS WEEK + CERTIFY (owner decision 2026-10-30, master plan batch
// C item 5). The trace (docs/CHANGELOG.md batch C) found up to a dozen
// separate signals per imported week: the document's low confidence (set
// on EVERY multi-page read by ai-import chunking.ts, so on every Prime PDF),
// Unverified, statement review reasons (never shown anywhere), the date
// check, "miles missing", the deadhead-pay flag. This module turns them into
// ONE list, "Things to check (N)", each with a stable id the owner can mark
// "Looks right" (settlements.review_acknowledged, §82), and a single
// Certify (certified_at + text version + app version). Rules:
// - a statement-backed (Verified) week takes gross AND miles from Prime's
//   statement, so the AI-header comparisons (milesMatch, grossMatches) are
//   not things to check; neither is the multi-page "low confidence" alone;
// - every other signal is one item, never two for the same cause.

// DRAFT — the owner's attorney reviews the final wording before public
// launch (docs/decisions/master-plan-2026-10.md batch C). Bump the version
// whenever the text changes: a certification records the version it was
// given under.
// Batch D2 (2026-10-31): the one line under "Certify and add to my books"
// (locale key importFlow.certifyLine shows the same words).
export const CERTIFICATION_TEXT_VERSION = 'draft-2026-10-31';
export const CERTIFICATION_TEXT = 'I checked these numbers against my statement. AI-generated estimates, not tax advice.';

export type WeekCheckKind =
  | 'date'
  | 'miles_missing'
  | 'unverified'
  | 'low_confidence'
  | 'statement_reason'
  | 'deadhead_pay_without_miles';

export type WeekCheckItem = {
  // Stable across renders and re-reads: what "Looks right" stores.
  id: string;
  kind: WeekCheckKind;
  // kind 'date': which date checks; kind 'statement_reason': which reason.
  dateReasons?: DateCheckReason[];
  reason?: StatementReviewReason;
  // The statement's own detail (check ids, pages, amounts) — shown as is.
  detail?: string;
};

export type WeekReviewSettlement = {
  id: string;
  week_ending: string;
  carrier: string | null;
  gross: number;
  miles: number | null;
  statement?: SettlementStatement | null;
  miles_split_flag?: string | null;
  review_acknowledged?: string[] | null;
  certified_at?: string | null;
};

// Warnings that compare the AI's header reading against the statement:
// on a statement-backed week the statement's own figure is what was saved.
const STATEMENT_SOURCED_WARNINGS = new Set(['milesMatch', 'grossMatches']);

export function buildWeekCheckItems(
  s: WeekReviewSettlement,
  ctx: { documentLowConfidence: boolean; today: string }
): WeekCheckItem[] {
  const items: WeekCheckItem[] = [];
  const verification = settlementVerification(s);

  const date = findSavedWeeksNeedingDateCheck([{ id: s.id, week_ending: s.week_ending, carrier: s.carrier, statement: s.statement ?? null }], ctx.today)[0];
  if (date) items.push({ id: `date:${date.reasons.join('+')}`, kind: 'date', dateReasons: date.reasons });

  if (Number(s.gross ?? 0) > 0 && !(Number(s.miles ?? 0) > 0)) items.push({ id: 'miles_missing', kind: 'miles_missing' });

  for (const r of s.statement?.reviewReasons ?? []) {
    let detail = r.label;
    if (r.reason === 'statement_warning' && verification === 'verified_prime') {
      const rest = r.label
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x && !STATEMENT_SOURCED_WARNINGS.has(x));
      if (rest.length === 0) continue;
      detail = rest.join(', ');
    }
    items.push({ id: `statement:${r.reason}:${detail}`, kind: 'statement_reason', reason: r.reason, detail });
  }

  if (s.miles_split_flag === 'deadhead_pay_without_miles') {
    items.push({ id: 'deadhead_pay_without_miles', kind: 'deadhead_pay_without_miles' });
  }

  if (verification === 'unverified') items.push({ id: 'unverified', kind: 'unverified' });

  // Low confidence on its own: only when nothing above already explains it
  // and the week is not checked against its statement.
  if (ctx.documentLowConfidence && verification !== 'verified_prime' && items.length === 0) {
    items.push({ id: 'low_confidence', kind: 'low_confidence' });
  }
  return items;
}

export type WeekReviewState = {
  items: WeekCheckItem[];
  open: WeekCheckItem[];
  certified: boolean;
  // Certify is offered once every item is marked "Looks right" (or there
  // are none) and the week is not already certified.
  canCertify: boolean;
};

export function weekReviewState(
  s: WeekReviewSettlement,
  ctx: { documentLowConfidence: boolean; today: string }
): WeekReviewState {
  const items = buildWeekCheckItems(s, ctx);
  const acknowledged = new Set(s.review_acknowledged ?? []);
  const open = items.filter((i) => !acknowledged.has(i.id));
  const certified = !!s.certified_at;
  return { items, open, certified, canCertify: !certified && open.length === 0 };
}

export function acknowledgeUpdate(s: Pick<WeekReviewSettlement, 'review_acknowledged'>, itemId: string): { review_acknowledged: string[] } {
  const current = s.review_acknowledged ?? [];
  return { review_acknowledged: current.includes(itemId) ? current : [...current, itemId] };
}

export function certifyUpdate(nowIso: string, appVersion: string) {
  return {
    certified_at: nowIso,
    certification_text_version: CERTIFICATION_TEXT_VERSION,
    certification_app_version: appVersion,
  };
}

// The rule the §82 triggers enforce, mirrored for the client and tests:
// any change to the week's own columns (other than the review columns and
// updated_at) clears the certification and the "Looks right" marks.
export const REVIEW_COLUMNS = ['review_acknowledged', 'certified_at', 'certification_text_version', 'certification_app_version', 'updated_at'];

export function clearsCertification(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (REVIEW_COLUMNS.includes(k)) continue;
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) return true;
  }
  return false;
}

export const CLEARED_CERTIFICATION = {
  review_acknowledged: null,
  certified_at: null,
  certification_text_version: null,
  certification_app_version: null,
};

// Tables whose rows belong to a week through settlement_id (the §82 child
// trigger list).
export const WEEK_CHILD_TABLES = ['loads', 'fuel_purchases', 'deductions', 'reimbursements', 'maintenance_records', 'tolls', 'driver_payments'];
