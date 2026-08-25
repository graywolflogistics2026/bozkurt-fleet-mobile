import type { Href } from 'expo-router';
import type { LinkedRecordRef } from '@/src/data/documentsFilter';

// PAYMENT + DESTINATION SUMMARY (owner decision 2026-08-24, device testing
// round, item 2) — the ONE shared route map both the Documents viewer and
// the Settlement detail sheet's "where it landed" block read from, so the
// two screens can never drift into routing the same ref kind differently.
// Only settlement/deduction/maintenance support jumping straight to the
// matching row (?openId=, wired into those 3 screens' own auto-open
// effects via findRowToAutoOpen); the rest land on the right list screen,
// same "at least get you to where it lives" bar as the others — fuel/
// load/reimbursement don't have an ?openId= auto-open wired up yet either.
export const LINKED_RECORD_ROUTE: Record<LinkedRecordRef['kind'], string> = {
  settlement: '/(tabs)/more/settlements',
  deduction: '/(tabs)/deductions',
  maintenance: '/(tabs)/more/maintenance',
  bank_statement: '/(tabs)/more/bank-statements',
  compliance_item: '/(tabs)/more/compliance',
  household_income: '/(tabs)/more/tax-estimator',
  fuel: '/(tabs)/more/fuel',
  load: '/(tabs)/more/loads',
  reimbursement: '/(tabs)/more/reimbursements',
};

const SUPPORTS_OPEN_ID = new Set<LinkedRecordRef['kind']>(['settlement', 'deduction', 'maintenance']);

export function buildLinkedRecordHref(ref: LinkedRecordRef): Href {
  const pathname = LINKED_RECORD_ROUTE[ref.kind];
  if (SUPPORTS_OPEN_ID.has(ref.kind)) {
    return { pathname, params: { openId: ref.id } } as unknown as Href;
  }
  return pathname as Href;
}
