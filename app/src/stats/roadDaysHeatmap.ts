import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';

export type RoadDayCell = { date: string; onRoad: boolean };

// Road Days heat map (Session 9d item 8) — GitHub-style grid of on-road
// days over the last N weeks. A day counts as "on-road" when it falls
// within a settlement's 7-day window (weekStartFromEnding(week_ending) ..
// week_ending) — the exact same deterministic definition per diem days
// already uses (CLAUDE.md invariant #9), never derived from AI-extracted
// load pickup/delivery dates. Returns oldest-first, weeksBack*7 cells.
export function buildRoadDaysGrid(weekEndings: string[], weeksBack = 12, now: Date = new Date()): RoadDayCell[] {
  const windows = [...new Set(weekEndings.filter(Boolean))].map((we) => ({ start: weekStartFromEnding(we), end: we }));

  const nowIso = now.toISOString().slice(0, 10);
  const totalDays = weeksBack * 7;
  const cells: RoadDayCell[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(`${nowIso}T12:00:00`);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const onRoad = windows.some((w) => iso >= w.start && iso <= w.end);
    cells.push({ date: iso, onRoad });
  }
  return cells;
}
