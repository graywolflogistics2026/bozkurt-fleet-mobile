// YTD CONTINUITY (owner decision 2026-11-03, R2). Prime prints each TOTAL
// line in the WEEKS, YTD and LTD columns. This week's YTD should equal last
// week's YTD plus this week's WEEKS. INFORMATIONAL ONLY: shown in
// Diagnostics, never a gate check, never blocks a save. The app counts the
// WEEKS column only.
import { parseAmount } from './amount';
import { normalizeStatementLabel } from './primeStatementLines';
import type { Extraction } from './types';

export type YtdRow = { label: string; weeks: number | null; ytd: number };
export type YtdContinuityRow = { label: string; ok: boolean; difference: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const numOrNull = (v: unknown): number | null => {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : null;
};

// The TOTAL and recap rows of this reading that printed a YTD figure.
export function statementYtdRows(extraction: Extraction | null | undefined): YtdRow[] {
  const op = extraction?.settlement?.operating as { totalLines?: unknown; recapLines?: unknown } | undefined;
  const out: YtdRow[] = [];
  const seen = new Set<string>();
  for (const list of [op?.totalLines, op?.recapLines]) {
    if (!Array.isArray(list)) continue;
    for (const l of list as { label?: unknown; weeks?: unknown; ytd?: unknown }[]) {
      const label = normalizeStatementLabel(typeof l?.label === 'string' ? l.label : '');
      const ytd = numOrNull(l?.ytd);
      if (!label || ytd == null || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, weeks: numOrNull(l?.weeks), ytd: r2(ytd) });
    }
  }
  return out;
}

// prev = last week's rows, cur = this week's. Only labels printed with a
// YTD in both weeks; a new year (YTD restarts) compares nothing.
export function ytdContinuity(
  prev: { weekEnding: string; rows: YtdRow[] },
  cur: { weekEnding: string; rows: YtdRow[] },
): YtdContinuityRow[] {
  if (prev.weekEnding.slice(0, 4) !== cur.weekEnding.slice(0, 4)) return [];
  const out: YtdContinuityRow[] = [];
  for (const row of cur.rows) {
    const before = prev.rows.find((p) => p.label === row.label);
    if (!before) continue;
    const difference = r2(row.ytd - (before.ytd + (row.weeks ?? 0)));
    out.push({ label: row.label, ok: Math.abs(difference) < 0.01, difference });
  }
  return out;
}

// The newest two saved weeks of the same unit that both stored YTD rows.
export function latestYtdContinuity(
  settlements: { week_ending?: string | null; statement?: unknown }[],
): { prevWeek: string; week: string; rows: YtdContinuityRow[] } | null {
  const weeks = settlements
    .map((s) => {
      const st = s.statement as { ytd?: YtdRow[] | null; unit?: string | null } | null | undefined;
      return { weekEnding: s.week_ending ?? '', unit: st?.unit ?? null, rows: Array.isArray(st?.ytd) ? st!.ytd! : [] };
    })
    .filter((w) => w.weekEnding && w.rows.length > 0)
    .sort((a, b) => (a.weekEnding < b.weekEnding ? 1 : a.weekEnding > b.weekEnding ? -1 : 0));
  const cur = weeks[0];
  if (!cur) return null;
  const prev = weeks.find((w) => w.weekEnding < cur.weekEnding && w.unit === cur.unit);
  if (!prev) return null;
  return { prevWeek: prev.weekEnding, week: cur.weekEnding, rows: ytdContinuity(prev, cur) };
}
