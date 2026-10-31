import { classifyMilesLabel, milesSplitUpdate, readMilesSplit } from '@/src/import/milesSplit';
import { calcMiles } from '@/src/stats/miles';

// Batch C item 6 (owner decision 2026-10-30).
describe('readMilesSplit — Prime keeps its exact reading', () => {
  it('8/21: RV lines LOADED / EMPTY -> 2,081 / 246 / 2,327, label EMPTY', () => {
    const split = readMilesSplit({
      carrier: 'PRIME INC.',
      loads: [
        { loadedMiles: 1055, emptyMiles: 146 },
        { loadedMiles: 1026, emptyMiles: 100 },
      ],
    });
    expect(split).toEqual({ loaded: 2081, empty: 246, total: 2327, source: 'loads', label: 'EMPTY', flag: null });
  });

  it('8/14: a mileless adjustment line adds nothing -> 2,739 / 577 / 3,316', () => {
    const split = readMilesSplit({
      carrier: 'Prime Inc',
      loads: [
        { loadedMiles: 1059, emptyMiles: 184 },
        { loadedMiles: 0, emptyMiles: 0 },
        { loadedMiles: 818, emptyMiles: 77 },
        { loadedMiles: 862, emptyMiles: 316 },
      ],
    });
    expect([split.loaded, split.empty, split.total]).toEqual([2739, 577, 3316]);
    expect(Math.round((split.empty! / split.total!) * 1000) / 10).toBe(17.4);
  });

  it('Prime never uses milesLines (carrier isolation)', () => {
    const split = readMilesSplit({ carrier: 'PRIME INC', loads: [], milesLines: [{ label: 'DEADHEAD', miles: 300 }] });
    expect(split.source).toBeNull();
  });
});

describe('readMilesSplit — generic reader for every other carrier', () => {
  it.each([
    ['DEADHEAD MILES', 'DEADHEAD'],
    ['DH MILES', 'DH'],
    ['UNLOADED MILES', 'UNLOADED'],
    ['EMPTY MILES', 'EMPTY'],
  ])('"%s" is empty miles, label kept', (label, word) => {
    const split = readMilesSplit({
      carrier: 'Acme Freight',
      milesLines: [
        { label: 'LOADED MILES', miles: 2000 },
        { label, miles: 250 },
        { label: 'TOTAL MILES', miles: 2250 },
      ],
    });
    expect(split).toEqual({ loaded: 2000, empty: 250, total: 2250, source: 'statement', label: word, flag: null });
  });

  it('only loaded and total printed -> empty = total - loaded, marked derived', () => {
    const split = readMilesSplit({ carrier: 'Acme', milesLines: [{ label: 'LOADED MILES', miles: 1800 }, { label: 'TOTAL MILES', miles: 2000 }] });
    expect(split).toMatchObject({ loaded: 1800, empty: 200, total: 2000, source: 'derived' });
  });

  it('a deadhead PAY line without miles is not the week\'s empty miles — flagged', () => {
    const split = readMilesSplit({
      carrier: 'Acme',
      milesLines: [
        { label: 'DEADHEAD PAY', miles: null },
        { label: 'LOADED MILES', miles: 1800 },
      ],
    });
    expect(split.empty).toBeNull();
    expect(split.source).toBeNull();
    expect(split.flag).toBe('deadhead_pay_without_miles');
  });

  it('bobtail and out-of-route miles are never deadhead; LTD/YTD lines are ignored', () => {
    expect(classifyMilesLabel('BOBTAIL MILES').kind).toBe('ignored');
    expect(classifyMilesLabel('OUT OF ROUTE MILES').kind).toBe('ignored');
    expect(classifyMilesLabel('OOR MILES').kind).toBe('ignored');
    expect(classifyMilesLabel('LTD MILES').kind).toBe('ignored');
    expect(classifyMilesLabel('YTD DEADHEAD').kind).toBe('ignored');
    const split = readMilesSplit({
      carrier: 'Acme',
      milesLines: [
        { label: 'LOADED MILES', miles: 1800 },
        { label: 'BOBTAIL MILES', miles: 60 },
        { label: 'TOTAL MILES', miles: 1800 },
      ],
    });
    expect(split).toMatchObject({ loaded: 1800, empty: 0, source: 'derived' });
  });

  it('nothing recognizable leaves the split null, never 0', () => {
    expect(readMilesSplit({ carrier: 'Acme', milesLines: [] })).toMatchObject({ loaded: null, empty: null, total: null, source: null });
    expect(readMilesSplit({ carrier: null, loads: [{ loadedMiles: undefined, emptyMiles: undefined }] }).source).toBeNull();
  });

  it('a total line repeated on two pages is taken once', () => {
    const split = readMilesSplit({
      carrier: 'Acme',
      milesLines: [
        { label: 'LOADED MILES', miles: 1800 },
        { label: 'DH', miles: 200 },
        { label: 'LOADED MILES', miles: 1800 },
        { label: 'DH', miles: 200 },
      ],
    });
    expect([split.loaded, split.empty, split.total]).toEqual([1800, 200, 2000]);
  });
});

describe('milesSplitUpdate — manual values survive re-imports; null never beats a number', () => {
  const reading = readMilesSplit({ carrier: 'PRIME INC', loads: [{ loadedMiles: 900, emptyMiles: 100 }] });
  it('a manual split is never replaced', () => {
    expect(milesSplitUpdate(reading, { miles_split_source: 'manual' })).toBeNull();
  });
  it('a missing reading keeps what is stored', () => {
    expect(milesSplitUpdate(readMilesSplit({ carrier: 'Acme' }), { miles_split_source: 'statement' })).toBeNull();
  });
  it('a real reading replaces a non-manual one', () => {
    expect(milesSplitUpdate(reading, { miles_split_source: 'loads' })).toMatchObject({ loaded_miles: 900, empty_miles: 100, miles_split_source: 'loads' });
  });
});

describe('calcMiles with the stored split', () => {
  it('a stored split wins over the loads; a week without any split is counted, not diluted', () => {
    const r = calcMiles(
      [
        { id: 'a', week_ending: '2026-08-14', miles: 3316, loaded_miles: 2700, empty_miles: 616, miles_split_source: 'manual' },
        { id: 'b', week_ending: '2026-08-21', miles: 2327 },
        { id: 'c', week_ending: '2026-08-28', miles: 1000 },
      ],
      [
        { settlement_id: 'a', loaded_miles: 2739, empty_miles: 577 },
        { settlement_id: 'b', loaded_miles: 2081, empty_miles: 246 },
      ]
    );
    const byId = Object.fromEntries(r.weeks.map((w) => [w.settlementId, w]));
    expect(byId.a).toMatchObject({ loadedMiles: 2700, emptyMiles: 616, splitSource: 'manual', totalMiles: 3316 });
    expect(byId.b).toMatchObject({ loadedMiles: 2081, emptyMiles: 246, splitSource: 'loads', totalMiles: 2327 });
    expect(byId.c).toMatchObject({ loadedMiles: null, emptyMiles: null, splitSource: null, totalMiles: 1000 });
    expect(r.weeksWithoutBreakdown).toBe(1);
    expect(r.totalMiles).toBe(6643);
    expect(r.loadedMiles).toBe(4781);
    expect(r.emptyMiles).toBe(862);
    expect(r.deadheadPct).toBeCloseTo(862 / 5643, 10);
  });

  it('with no stored split the result is unchanged from before (loads only)', () => {
    const r = calcMiles([{ id: 'b', week_ending: '2026-08-21', miles: 2327 }], [
      { settlement_id: 'b', loaded_miles: 1055, empty_miles: 146 },
      { settlement_id: 'b', loaded_miles: 1026, empty_miles: 100 },
    ]);
    expect([r.totalMiles, r.loadedMiles, r.emptyMiles]).toEqual([2327, 2081, 246]);
    expect(Math.round(r.deadheadPct! * 1000) / 10).toBe(10.6);
  });
});
