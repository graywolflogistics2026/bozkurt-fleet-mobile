// CANONICAL MILES (owner decision 2026-08-05, FULL PARITY follow-up item
// B.1) — the ONE shared miles calculation every screen that needs a mile
// figure (CPM, RPM, the Miles editor, the Accountant Package) reads from,
// replacing the raw `sum(settlements.miles)` every one of them used to
// compute independently. Fixes a real bug verified against web: a
// duplicate settlement week (two settlement rows sharing the same
// (truck_id, week_ending) — structurally rare on mobile thanks to
// CLAUDE.md invariant #10's `(user_id, week_ending, truck_id)` unique
// constraint + replace-on-reimport logic, but real for any row saved
// BEFORE that constraint existed, or a legacy-backup import) silently
// DOUBLED the miles total on web, since nothing ever deduped by week.

export type SettlementMilesInput = {
  id: string;
  truck_id?: string | null;
  week_ending: string | null;
  miles: number | null;
};

export type LoadMilesInput = {
  settlement_id: string | null;
  loaded_miles: number | null;
  empty_miles: number | null;
};

// One settlement week's reconciled miles — kept per-week (not just
// summed) so the Miles editor can show/edit each week individually.
export type WeekMiles = {
  settlementId: string;
  truckId: string | null;
  weekEnding: string;
  statementMiles: number;
  loadsLoadedMiles: number;
  loadsEmptyMiles: number;
  // Reconciliation rule (spec item B.1): total = MAX(the settlement's own
  // printed total, the sum of that week's loads' loaded+empty) — never
  // the SUM of both, which would double-count whichever figure is more
  // complete. When the loads sum is the smaller of the two, the
  // shortfall against the settlement's own total is real but
  // unattributed between loaded/empty (we only know the loads' own
  // split) — `loadsLoadedMiles`/`loadsEmptyMiles` stay exactly what the
  // loads say, never inflated to force-match `totalMiles`.
  totalMiles: number;
};

export type CalcMilesResult = {
  totalMiles: number;
  loadedMiles: number;
  emptyMiles: number;
  // null when totalMiles is 0 — never a divide-by-zero NaN.
  deadheadPct: number | null;
  // A genuine duplicate (same truck_id + week_ending appearing on 2+
  // settlement rows) — the LOWER-total row(s) are excluded from every
  // sum above and counted here so the UI can surface "N duplicate
  // settlement weeks ignored" and let the user delete them.
  duplicateWeeksIgnored: number;
  weeks: WeekMiles[];
};

export function calcMiles(settlements: SettlementMilesInput[], loads: LoadMilesInput[]): CalcMilesResult {
  const loadsBySettlement = new Map<string, { loaded: number; empty: number }>();
  for (const l of loads) {
    if (!l.settlement_id) continue;
    const cur = loadsBySettlement.get(l.settlement_id) ?? { loaded: 0, empty: 0 };
    cur.loaded += Number(l.loaded_miles ?? 0);
    cur.empty += Number(l.empty_miles ?? 0);
    loadsBySettlement.set(l.settlement_id, cur);
  }

  const weeksByKey = new Map<string, WeekMiles>();
  let duplicateWeeksIgnored = 0;

  for (const s of settlements) {
    if (!s.week_ending) continue;
    const key = `${s.truck_id ?? 'none'}|${s.week_ending}`;
    const loadsAgg = loadsBySettlement.get(s.id) ?? { loaded: 0, empty: 0 };
    const statementMiles = Number(s.miles ?? 0);
    const loadsSum = loadsAgg.loaded + loadsAgg.empty;
    const candidate: WeekMiles = {
      settlementId: s.id,
      truckId: s.truck_id ?? null,
      weekEnding: s.week_ending,
      statementMiles,
      loadsLoadedMiles: loadsAgg.loaded,
      loadsEmptyMiles: loadsAgg.empty,
      totalMiles: Math.max(statementMiles, loadsSum),
    };

    const existing = weeksByKey.get(key);
    if (!existing) {
      weeksByKey.set(key, candidate);
      continue;
    }
    duplicateWeeksIgnored += 1;
    // Keep whichever duplicate has the MORE COMPLETE data (higher total)
    // — the other is the one being "ignored."
    if (candidate.totalMiles > existing.totalMiles) weeksByKey.set(key, candidate);
  }

  const weeks = [...weeksByKey.values()];
  const totalMiles = weeks.reduce((sum, w) => sum + w.totalMiles, 0);
  const loadedMiles = weeks.reduce((sum, w) => sum + w.loadsLoadedMiles, 0);
  const emptyMiles = weeks.reduce((sum, w) => sum + w.loadsEmptyMiles, 0);

  return {
    totalMiles,
    loadedMiles,
    emptyMiles,
    deadheadPct: totalMiles > 0 ? emptyMiles / totalMiles : null,
    duplicateWeeksIgnored,
    weeks: weeks.sort((a, b) => b.weekEnding.localeCompare(a.weekEnding)),
  };
}

// MANUAL TOTAL OVERRIDE (spec item B.3) — a user-entered odometer/ELD
// total supersedes the weekly-calculated figure entirely for CPM/RPM
// purposes. Loaded/empty/deadhead% stay from the weekly calc (the
// override is a TOTAL-only figure — an odometer reading has no
// loaded-vs-empty breakdown of its own), so `calcMiles()`'s own result
// is always computed first and this only swaps the `totalMiles` field a
// caller actually uses for CPM.
export type MilesSource = 'settlements' | 'manual';

export function resolveMilesTotal(
  calculated: { totalMiles: number },
  manualOverride: number | null | undefined
): { totalMiles: number; source: MilesSource } {
  if (manualOverride != null && manualOverride > 0) {
    return { totalMiles: manualOverride, source: 'manual' };
  }
  return { totalMiles: calculated.totalMiles, source: 'settlements' };
}
