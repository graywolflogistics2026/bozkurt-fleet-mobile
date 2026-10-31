import { supabase } from '@/src/lib/supabase';
import { buildMarkDocumentReviewedUpdate } from '@/src/import/needsReview';
import { acknowledgeUpdate, certifyUpdate } from '@/src/import/weekReview';
import { missingColumnIn } from '@/src/data/fleetEdit';

// REVIEW THIS WEEK + CERTIFY, per-week miles edit (batch C, §82). Every
// write checks that a row was actually changed (no silent no-op) and turns
// "column does not exist" into one clear error until §82 has run.

export class WeekReviewNotInstalledError extends Error {
  constructor() {
    super('Needs the database update PENDING_SQL §82');
    this.name = 'WeekReviewNotInstalledError';
  }
}

const REVIEW_COLUMNS = ['review_acknowledged', 'certified_at', 'certification_text_version', 'certification_app_version', 'loaded_miles', 'empty_miles', 'miles_split_source'] as const;

async function updateSettlement(id: string, values: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from('settlements').update(values).eq('id', id).select('id');
  if (error) {
    if (missingColumnIn(error, REVIEW_COLUMNS) || error.code === '42703') throw new WeekReviewNotInstalledError();
    throw error;
  }
  if (!data || data.length === 0) throw new Error('Week not found');
}

export async function acknowledgeWeekItem(settlement: { id: string; review_acknowledged?: string[] | null }, itemId: string): Promise<void> {
  await updateSettlement(settlement.id, acknowledgeUpdate(settlement, itemId));
}

// Certify reuses documents.reviewed_at: the week's document is marked
// reviewed too, so the existing "needs review" chips clear with it.
export async function certifyWeek(
  settlement: { id: string; document_id: string | null },
  appVersion: string,
  nowIso: string = new Date().toISOString()
): Promise<void> {
  await updateSettlement(settlement.id, certifyUpdate(nowIso, appVersion));
  if (settlement.document_id) {
    const { error } = await supabase.from('documents').update(buildMarkDocumentReviewedUpdate(nowIso)).eq('id', settlement.document_id);
    if (error) throw error;
  }
}

// A manual loaded/empty split — survives re-imports (milesSplitUpdate()).
export function validateMilesSplit(loaded: number | null, empty: number | null): 'ok' | 'missing' | 'negative' {
  if (loaded == null || empty == null) return 'missing';
  if (loaded < 0 || empty < 0) return 'negative';
  return 'ok';
}

export async function saveManualMilesSplit(settlementId: string, loaded: number, empty: number): Promise<void> {
  await updateSettlement(settlementId, {
    loaded_miles: loaded,
    empty_miles: empty,
    miles_split_source: 'manual',
    miles_split_flag: null,
  });
}
