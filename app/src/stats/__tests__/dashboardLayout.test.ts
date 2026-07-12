import { mergeDashboardLayout, isDefaultLayout, DEFAULT_CARD_ORDER } from '@/src/stats/dashboardLayout';

describe('isDefaultLayout', () => {
  it('treats null and undefined as default, everything else as customized', () => {
    expect(isDefaultLayout(null)).toBe(true);
    expect(isDefaultLayout(undefined)).toBe(true);
    expect(isDefaultLayout([])).toBe(false);
  });
});

describe('mergeDashboardLayout', () => {
  it('returns every default card, visible, unlabeled, in default order when nothing is stored', () => {
    const merged = mergeDashboardLayout(null);
    expect(merged.map((m) => m.id)).toEqual([...DEFAULT_CARD_ORDER]);
    expect(merged.every((m) => m.visible && m.label === null)).toBe(true);
  });

  it('preserves stored order/visibility/label for known ids', () => {
    const stored = [
      { id: 'netToOwner', visible: true, label: 'My Net' },
      { id: 'totalRevenue', visible: false, label: null },
    ];
    const merged = mergeDashboardLayout(stored, ['totalRevenue', 'netToOwner', 'milesDriven']);
    expect(merged[0]).toEqual({ id: 'netToOwner', visible: true, label: 'My Net' });
    expect(merged[1]).toEqual({ id: 'totalRevenue', visible: false, label: null });
    // missing 'milesDriven' appended at the end, visible by default
    expect(merged[2]).toEqual({ id: 'milesDriven', visible: true, label: null });
  });

  it('drops stored ids that no longer correspond to a real card', () => {
    const stored = [{ id: 'ghostCard', visible: true, label: null }];
    const merged = mergeDashboardLayout(stored, ['totalRevenue']);
    expect(merged.map((m) => m.id)).toEqual(['totalRevenue']);
  });

  it('drops duplicate stored entries for the same id, keeping the first', () => {
    const stored = [
      { id: 'totalRevenue', visible: false, label: 'First' },
      { id: 'totalRevenue', visible: true, label: 'Second' },
    ];
    const merged = mergeDashboardLayout(stored, ['totalRevenue']);
    expect(merged).toEqual([{ id: 'totalRevenue', visible: false, label: 'First' }]);
  });

  it('treats a malformed stored array entry as ignorable rather than throwing', () => {
    const stored = [null, { notAnId: true }, { id: 'totalRevenue', visible: true, label: null }];
    const merged = mergeDashboardLayout(stored, ['totalRevenue']);
    expect(merged).toEqual([{ id: 'totalRevenue', visible: true, label: null }]);
  });
});
