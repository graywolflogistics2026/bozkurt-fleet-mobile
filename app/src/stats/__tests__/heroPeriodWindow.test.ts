import { resolveHeroPeriodDateWindow, filterRowsByDateWindow } from '@/src/stats/heroPeriodWindow';

const weekEndings = ['2026-06-06', '2026-06-13', '2026-06-20', '2026-06-27'];

describe('resolveHeroPeriodDateWindow', () => {
  it('resolves "thisWeek" to the 7-day window ending at the LATEST week_ending', () => {
    const window = resolveHeroPeriodDateWindow('thisWeek', weekEndings);
    expect(window).toEqual({ startIso: '2026-06-21', endIso: '2026-06-27' });
  });

  it('resolves "lastWeek" to the window ending at the SECOND-latest week_ending', () => {
    const window = resolveHeroPeriodDateWindow('lastWeek', weekEndings);
    expect(window).toEqual({ startIso: '2026-06-14', endIso: '2026-06-20' });
  });

  it('returns null for "thisWeek"/"lastWeek" when there are no settlement weeks at all', () => {
    expect(resolveHeroPeriodDateWindow('thisWeek', [])).toBeNull();
    expect(resolveHeroPeriodDateWindow('lastWeek', [])).toBeNull();
  });

  it('returns null for "lastWeek" when only one settlement week exists (no prior week to resolve to)', () => {
    expect(resolveHeroPeriodDateWindow('lastWeek', ['2026-06-27'])).toBeNull();
  });

  it('resolves "1M"/"3M"/"6M"/"yearly" to rolling N-day windows ending "now", independent of week_ending data', () => {
    const now = new Date('2026-08-15T12:00:00');
    expect(resolveHeroPeriodDateWindow('1M', [], now)).toEqual({ startIso: '2026-07-16', endIso: '2026-08-15' });
    expect(resolveHeroPeriodDateWindow('3M', [], now)).toEqual({ startIso: '2026-05-17', endIso: '2026-08-15' });
    expect(resolveHeroPeriodDateWindow('6M', [], now)).toEqual({ startIso: '2026-02-16', endIso: '2026-08-15' });
    expect(resolveHeroPeriodDateWindow('yearly', [], now)).toEqual({ startIso: '2025-08-15', endIso: '2026-08-15' });
  });
});

describe('filterRowsByDateWindow', () => {
  const rows = [{ id: 'a', d: '2026-06-10' }, { id: 'b', d: '2026-06-20' }, { id: 'c', d: null }, { id: 'd', d: '2026-07-01' }];

  it('keeps only rows whose date falls within [startIso, endIso] inclusive', () => {
    const result = filterRowsByDateWindow(rows, (r) => r.d, { startIso: '2026-06-15', endIso: '2026-06-25' });
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('returns an empty array (never all rows) when the window is null — "no data," never a silent fallback to unfiltered', () => {
    expect(filterRowsByDateWindow(rows, (r) => r.d, null)).toEqual([]);
  });

  it('excludes rows with no date at all', () => {
    const result = filterRowsByDateWindow(rows, (r) => r.d, { startIso: '2020-01-01', endIso: '2030-01-01' });
    expect(result.find((r) => r.id === 'c')).toBeUndefined();
  });
});
