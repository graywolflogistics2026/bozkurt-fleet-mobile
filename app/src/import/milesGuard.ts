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
