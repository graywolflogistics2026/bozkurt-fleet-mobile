import type { Extraction, ExtractedLoad } from '@/src/import/types';

// MILES TRAP (owner decision 2026-08-02, CRITICAL BUG FIX — verified
// against a real statement: a settlement printed a "LTD MILES" (lifetime-
// to-date) figure right next to the week's own revenue/loads section, and
// the AI extracted totalMiles as that lifetime number instead of the
// week's actual (zero, since there were no loads that week) miles figure.
// Carrier statements routinely print "LTD MILES"/"MILES QTD"/"YTD MILES"
// near the weekly totals — this is a genuinely easy trap for an AI
// extraction to fall into. Two deterministic guards, applied once right
// after the AI extraction is received (src/data/aiImportCall.ts), same
// "sanitize once, every downstream consumer — mapSettlement() AND the
// import preview's per-diem smart default — sees the corrected value"
// pattern as dateGuard.ts's sanitizeExtractionDates(). This drives
// per-diem (0 miles -> 0 days, src/tax/perDiem.ts), CPM, and RPM, so a
// wrong lifetime figure here would silently poison all three.
//
//   1. No loads this week (a genuine "home week") but a nonzero miles
//      figure was extracted — silently corrected to 0. Unambiguous: zero
//      loads means zero miles driven for pay this week, full stop — no
//      review flag needed, there's nothing for the user to judge.
//   2. Loads exist with real mileage, but the extracted weekly total is
//      implausibly larger than what those loads actually sum to (a
//      lifetime/QTD/YTD figure misread as this week's own total) — the
//      loads' own summed mileage is used instead, and the extraction's
//      confidence is downgraded to "low" so the existing needs-review
//      machinery (src/import/needsReview.ts, driven by
//      documents.parsed_json.confidence, CLAUDE.md invariant #14)
//      surfaces it for the user to confirm — unlike rule 1, this
//      correction is a judgment call (how large a mismatch is "implausible"
//      is a threshold, not a certainty), so it's flagged rather than silent.
//   3. NULL MUST NEVER BEAT A NUMBER (owner decision 2026-08-24, MILES
//      READ BUT NOT USED fix) — the mirror-image gap of rule 2: loads
//      exist with a real, nonzero summed mileage, but the settlement's
//      own totalMiles came back IMPLAUSIBLY SMALLER than that (most
//      commonly exactly 0 or missing — a header/summary scalar the model
//      didn't see on whatever page/chunk it read, e.g. a multi-page
//      settlement's own recap section landing on a later page while a
//      server-side merge's "chunk[0] priority" rule for this exact field
//      — supabase/functions/ai-import/chunking.ts's
//      mergeChunkedExtractions() — only ever trusts the FIRST page's own
//      reading). loadMilesSum is real, per-load extracted data that can
//      never legitimately exceed the week's own total, so it's always
//      safe to prefer over a raw total that can't even account for the
//      loads actually on the statement. Flagged (a judgment call, same as
//      rule 2, not a certainty like rule 1) so the user confirms it.
const MILES_TRAP_RATIO = 1.5;

function sumLoadMiles(loads: Pick<ExtractedLoad, 'loadedMiles' | 'emptyMiles'>[]): number {
  return loads.reduce((sum, l) => sum + Math.max(0, Number(l.loadedMiles ?? 0)) + Math.max(0, Number(l.emptyMiles ?? 0)), 0);
}

export type WeeklyMilesResult = { miles: number; flagged: boolean };

export function resolveWeeklyMiles(
  totalMiles: number | null | undefined,
  loads: Pick<ExtractedLoad, 'loadedMiles' | 'emptyMiles'>[]
): WeeklyMilesResult {
  const raw = Number(totalMiles ?? 0);

  if (loads.length === 0) {
    return { miles: raw !== 0 ? 0 : raw, flagged: false };
  }

  const loadMilesSum = sumLoadMiles(loads);
  // Only trigger the "implausibly large" guard when there's a real,
  // nonzero load-miles figure to compare against — if the loads exist but
  // carry no mileage data of their own (loadMilesSum === 0), there's
  // nothing safe to fall back to, so the extracted totalMiles is left
  // as-is rather than guessed away.
  if (loadMilesSum > 0 && raw > loadMilesSum * MILES_TRAP_RATIO) {
    return { miles: loadMilesSum, flagged: true };
  }

  // Rule 3 — see this file's own header comment. loadMilesSum can never
  // legitimately exceed the week's own real total, so `raw < loadMilesSum`
  // is an unambiguous sign totalMiles itself was lost/undercounted
  // somewhere upstream, most commonly landing exactly at raw === 0.
  if (loadMilesSum > 0 && raw < loadMilesSum) {
    return { miles: loadMilesSum, flagged: true };
  }

  return { miles: raw, flagged: false };
}

// Applied once, right after the AI extraction is received (src/data/
// aiImportCall.ts) — mirrors sanitizeExtractionDates()'s placement exactly
// so mapSettlement() and the import preview's applyDefaultPerDiemDays()
// both see the corrected totalMiles automatically, with no separate fix
// needed at either call site.
export function sanitizeExtractionMiles(extraction: Extraction): Extraction {
  if (extraction.docType !== 'settlement' || !extraction.settlement) return extraction;
  const s = extraction.settlement;
  const { miles, flagged } = resolveWeeklyMiles(s.totalMiles, s.loads ?? []);
  if (miles === (s.totalMiles ?? 0) && !flagged) return extraction;
  return {
    ...extraction,
    confidence: flagged ? 'low' : extraction.confidence,
    settlement: { ...s, totalMiles: miles },
  };
}
