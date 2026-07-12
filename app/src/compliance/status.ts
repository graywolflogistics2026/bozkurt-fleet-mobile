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

export function calcComplianceStatus(dueDate: string, now: Date = new Date()): ComplianceStatusResult {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);
  const urgency: ComplianceUrgency = daysUntil < 0 ? 'overdue' : daysUntil <= DUE_SOON_THRESHOLD_DAYS ? 'due_soon' : 'ok';
  return { daysUntil, urgency };
}

// Sorts soonest-due first — overdue items (negative daysUntil) sort
// before everything else automatically since they're the most negative.
export function sortByDueDate(items: ComplianceItem[]): ComplianceItem[] {
  return [...items].sort((a, b) => a.due_date.localeCompare(b.due_date));
}
