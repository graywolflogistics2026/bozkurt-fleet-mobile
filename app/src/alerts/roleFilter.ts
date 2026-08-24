import type { ComplianceType } from '@/src/compliance/status';

export type ProfileRole = 'owner_operator' | 'company_driver_w2' | 'contractor_1099' | 'trainee' | 'lease_operator' | null;

// ROLE-AWARE ALERTS (owner decision 2026-08-24, NEXT PASS item D1): a
// company driver — or anyone who doesn't own/lease the truck — must NEVER
// be asked for truck documents, only their own personal DOT items.
//
// TRUCK-related compliance types (need the truck's own paperwork):
// HVUT 2290, IRP registration (covers "registration/cab card"/state
// stickers like NY HUT — this schema has no separate type for those),
// annual DOT inspection, insurance policy renewal, IFTA quarterly filing.
const TRUCK_COMPLIANCE_TYPES: ComplianceType[] = ['hvut_2290', 'irp_registration', 'annual_inspection', 'insurance_policy', 'ifta_filing'];

// PERSONAL compliance types (tied to the DRIVER, not the truck) — medical
// card and CDL are named explicitly in the spec; drug_consortium enrollment
// is also a driver-level DOT requirement (applies to any CDL holder
// regardless of who owns the truck they're driving), so it's grouped here
// too rather than with the truck types. 'other' has no reliable truck-vs-
// personal signal of its own — shown to everyone rather than risking a
// real reminder silently disappearing for the wrong role.
const PERSONAL_COMPLIANCE_TYPES: ComplianceType[] = ['medical_card', 'cdl', 'drug_consortium'];

// Roles that own or lease the equipment they drive, so they see BOTH truck
// and personal items (they're the owner/lessee AND the driver at once).
// contractor_1099 is included per CLAUDE.md invariant #18 — it gets the
// full Schedule C experience, same as owner_operator, implying it also
// handles its own truck-related business expenses. `trainee` is excluded
// (riding along, not yet operating their own truck) and treated like
// company_driver_w2 — personal items only.
const TRUCK_OWNING_ROLES = new Set<ProfileRole>(['owner_operator', 'lease_operator', 'contractor_1099']);

// role === null: "ask once rather than assuming" (spec's own words) — see
// resolveRolePromptNeeded below. Until answered, every compliance type
// stays visible (never silently hide a real DOT deadline while waiting on
// an answer nobody's been asked for yet).
export function isComplianceTypeVisibleForRole(role: ProfileRole, type: ComplianceType): boolean {
  if (!TRUCK_COMPLIANCE_TYPES.includes(type)) return true; // personal + 'other' — always visible
  if (role === null) return true;
  return TRUCK_OWNING_ROLES.has(role);
}

export function isOwnerRole(role: ProfileRole): boolean {
  return role === null || TRUCK_OWNING_ROLES.has(role);
}

// Drives whether the Alerts screen shows its one-time "what's your role?"
// prompt — `rolePromptDismissedAt` is set either by picking a role (which
// also sets `role` itself, so this branch never re-fires) or by explicitly
// dismissing without answering (profiles.role_prompt_dismissed_at,
// docs/PENDING_SQL.md §49) — "ask once," never every session.
export function resolveRolePromptNeeded(role: ProfileRole, rolePromptDismissedAt: string | null | undefined): boolean {
  return role === null && !rolePromptDismissedAt;
}
