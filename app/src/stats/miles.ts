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
  // Batch C item 6 (§82): the week's stored loaded / empty split
  // (src/import/milesSplit.ts). Absent or null -> the loads' own columns.
  loaded_miles?: number | null;
  empty_miles?: number | null;
  miles_split_source?: string | null;
  miles_split_label?: string | null;
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
  // Batch C item 6: the week's split as shown everywhere — the stored
  // settlement split when present, else the loads' columns when any load
  // carries miles, else null ("without breakdown", never 0).
  loadedMiles: number | null;
  emptyMiles: number | null;
  splitSource: 'loads' | 'statement' | 'derived' | 'manual' | null;
  splitLabel: string | null;
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
  // Weeks with no loaded/empty split at all (batch C item 6).
  weeksWithoutBreakdown: number;
  weeks: WeekMiles[];
};

export function calcMiles(settlements: SettlementMilesInput[], loads: LoadMilesInput[]): CalcMilesResult {
  const loadsBySettlement = new Map<string, { loaded: number; empty: number; any: boolean }>();
  for (const l of loads) {
    if (!l.settlement_id) continue;
    const cur = loadsBySettlement.get(l.settlement_id) ?? { loaded: 0, empty: 0, any: false };
    cur.loaded += Number(l.loaded_miles ?? 0);
    cur.empty += Number(l.empty_miles ?? 0);
    if (l.loaded_miles != null || l.empty_miles != null) cur.any = true;
    loadsBySettlement.set(l.settlement_id, cur);
  }

  const weeksByKey = new Map<string, WeekMiles>();
  let duplicateWeeksIgnored = 0;

  for (const s of settlements) {
    if (!s.week_ending) continue;
    const key = `${s.truck_id ?? 'none'}|${s.week_ending}`;
    const loadsAgg = loadsBySettlement.get(s.id) ?? { loaded: 0, empty: 0, any: false };
    const statementMiles = Number(s.miles ?? 0);
    const stored = s.loaded_miles != null && s.empty_miles != null;
    const loadsHaveSplit = loadsAgg.any && loadsAgg.loaded + loadsAgg.empty > 0;
    const loadedMiles = stored ? Number(s.loaded_miles) : loadsHaveSplit ? loadsAgg.loaded : null;
    const emptyMiles = stored ? Number(s.empty_miles) : loadsHaveSplit ? loadsAgg.empty : null;
    const splitSum = (loadedMiles ?? 0) + (emptyMiles ?? 0);
    const candidate: WeekMiles = {
      settlementId: s.id,
      truckId: s.truck_id ?? null,
      weekEnding: s.week_ending,
      statementMiles,
      loadsLoadedMiles: loadsAgg.loaded,
      loadsEmptyMiles: loadsAgg.empty,
      loadedMiles,
      emptyMiles,
      splitSource: stored ? ((s.miles_split_source as WeekMiles['splitSource']) ?? 'statement') : loadsHaveSplit ? 'loads' : null,
      splitLabel: stored ? s.miles_split_label ?? null : null,
      totalMiles: Math.max(statementMiles, splitSum),
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
  const withSplit = weeks.filter((w) => w.loadedMiles != null && w.emptyMiles != null);
  const loadedMiles = withSplit.reduce((sum, w) => sum + (w.loadedMiles ?? 0), 0);
  const emptyMiles = withSplit.reduce((sum, w) => sum + (w.emptyMiles ?? 0), 0);
  // Deadhead % over the weeks that HAVE a split — a week without one must
  // not dilute it (its miles are unknown, not empty-free).
  const splitTotal = withSplit.reduce((sum, w) => sum + w.totalMiles, 0);

  return {
    totalMiles,
    loadedMiles,
    emptyMiles,
    deadheadPct: splitTotal > 0 ? emptyMiles / splitTotal : null,
    duplicateWeeksIgnored,
    weeksWithoutBreakdown: weeks.length - withSplit.length,
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
