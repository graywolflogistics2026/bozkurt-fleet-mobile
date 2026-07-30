import { findRowToAutoOpen } from '@/src/navigation/autoOpenParam';

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];

describe('findRowToAutoOpen', () => {
  it('finds the matching row when openId is set and not yet opened', () => {
    expect(findRowToAutoOpen(rows, 'b', false)).toEqual({ id: 'b', name: 'Beta' });
  });

  it('returns null when openId is undefined', () => {
    expect(findRowToAutoOpen(rows, undefined, false)).toBeNull();
  });

  it('returns null when openId is null', () => {
    expect(findRowToAutoOpen(rows, null, false)).toBeNull();
  });

  it('returns null once already opened, even if openId still matches', () => {
    expect(findRowToAutoOpen(rows, 'b', true)).toBeNull();
  });

  it('returns null when no row matches the id', () => {
    expect(findRowToAutoOpen(rows, 'nonexistent', false)).toBeNull();
  });

  it('returns null on an empty row list', () => {
    expect(findRowToAutoOpen([], 'a', false)).toBeNull();
  });
});
