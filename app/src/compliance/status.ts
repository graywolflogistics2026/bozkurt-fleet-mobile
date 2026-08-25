import type { ComplianceItem } from '@/src/types/db';

export type ComplianceType = ComplianceItem['type'];
export type Recurrence = NonNullable<ComplianceItem['recurrence']>;
export type ComplianceUrgency = 'overdue' | 'due_soon' | 'ok';

export const COMPLIANCE_TYPES: ComplianceType[] = [
  'medical_card',
  'annual_inspection',
  'irp_registration',
  'hvut_2290',
  'ifta_filing',
  'insurance_policy',
  'cdl',
  'drug_consortium',
  'other',
];

export const COMPLIANCE_TYPE_ICON: Record<ComplianceType, string> = {
  medical_card: '🩺',
  annual_inspection: '🔍',
  irp_registration: '🚚',
  hvut_2290: '🧾',
  ifta_filing: '⛽',
  insurance_policy: '🛡️',
  cdl: '🪪',
  drug_consortium: '🧪',
  other: '📄',
};

// Sensible per-type recurrence defaults (PROMPTS.md Session 9b item 9 —
// "pick a sensible per-type default ... rather than leaving it unset").
// Only a starting point for the add form — always user-editable, never
// enforced. hvut_2290 is explicitly called out as always-annual in the
// spec; ifta_filing is quarterly by name. medical_card defaults to the
// longest standard DOT medical-certificate term (2 years) rather than the
// shortest, since a shorter actual term is still just as editable. cdl
// renewal cadence varies too widely by state (4-8 years) to fit any of
// our four enum values, so it defaults to 'none' (no fixed recurrence)
// same as the open-ended 'other' catch-all.
export const DEFAULT_RECURRENCE: Record<ComplianceType, Recurrence> = {
  medical_card: 'biennial',
  annual_inspection: 'annual',
  irp_registration: 'annual',
  hvut_2290: 'annual',
  ifta_filing: 'quarterly',
  insurance_policy: 'annual',
  cdl: 'none',
  drug_consortium: 'annual',
  other: 'none',
};

// Countdown thresholds mirror the day-based (not mileage-based) urgency
// scheme already established for tax quarterly deadlines
// (src/tax/quarterly.ts) rather than Truck Health's mileage-percentage
// scheme, since a compliance due_date is a calendar date like a tax
// deadline, not an odometer/hours interval.
const DUE_SOON_THRESHOLD_DAYS = 30;

export type ComplianceStatusResult = {
  daysUntil: number;
  urgency: ComplianceUrgency;
};

// DOCUMENTS & RENEWALS EXPANSION (owner decision 2026-08-24, device
// testing round, item 3) — `reminderLeadDays` is the per-item override
// (`compliance_items.reminder_lead_days`, docs/PENDING_SQL.md §55b): a
// manual item's own "remind me N days before" setting. `null`/`undefined`
// (every row seeded before this column existed, or a built-in item nobody
// customized) falls back to the app-wide 30-day default unchanged — this
// is purely additive, no existing caller's behavior changes unless it
// starts passing a real value.
export function calcComplianceStatus(
  dueDate: string,
  now: Date = new Date(),
  reminderLeadDays?: number | null
): ComplianceStatusResult {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);
  const threshold = reminderLeadDays ?? DUE_SOON_THRESHOLD_DAYS;
  const urgency: ComplianceUrgency = daysUntil < 0 ? 'overdue' : daysUntil <= threshold ? 'due_soon' : 'ok';
  return { daysUntil, urgency };
}

// Sorts soonest-due first — overdue items (negative daysUntil) sort
// before everything else automatically since they're the most negative.
export function sortByDueDate(items: ComplianceItem[]): ComplianceItem[] {
  return [...items].sort((a, b) => a.due_date.localeCompare(b.due_date));
}
