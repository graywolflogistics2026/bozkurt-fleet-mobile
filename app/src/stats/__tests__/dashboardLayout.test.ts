import { mergeDashboardLayout, isDefaultLayout, DEFAULT_CARD_ORDER } from '@/src/stats/dashboardLayout';

describe('isDefaultLayout', () => {
  it('treats null and undefined as default, everything else as customized', () => {
    expect(isDefaultLayout(null)).toBe(true);
    expect(isDefaultLayout(undefined)).toBe(true);
    expect(isDefaultLayout([])).toBe(false);
  });
});

describe('mergeDashboardLayout', () => {
  it('returns every default card, unlabeled, in default order when nothing is stored', () => {
    const merged = mergeDashboardLayout(null);
    expect(merged.map((m) => m.id)).toEqual([...DEFAULT_CARD_ORDER]);
    expect(merged.every((m) => m.label === null)).toBe(true);
  });

  it('defaults cards absorbed into the new zoned design (device feedback round 2) to hidden, not visible', () => {
    // Dashboard redesign: these are hidden from a fresh/never-touched
    // layout (still fully available via Customize) — asserting the
    // specific ids the redesign calls out, not "every card."
    const merged = mergeDashboardLayout(null);
    const byId = Object.fromEntries(merged.map((m) => [m.id, m.visible]));
    expect(byId.totalRevenue).toBe(false);
    expect(byId.ytdPerDiemDays).toBe(false);
    expect(byId.perDiemDeduction).toBe(false);
    expect(byId.milesDriven).toBe(false);
    expect(byId.weeksInService).toBe(false);
    expect(byId.avgNetPerWeek).toBe(false);
    expect(byId.businessBalance).toBe(false);
    expect(byId.effectiveRate).toBe(false);
    expect(byId.scorpPreview).toBe(false);
    // Everything else stays visible by default, e.g. the new Zone 4 trio
    // and the new combined per-diem card.
    expect(byId.perDiemSummary).toBe(true);
    expect(byId.revenuePerMile).toBe(true);
    expect(byId.costPerMile).toBe(true);
    expect(byId.profitPerMile).toBe(true);
    expect(byId.netToOwner).toBe(true);
    expect(byId.totalDeductions).toBe(true);
  });

  it('preserves stored order/visibility/label for known ids', () => {
    const stored = [
      { id: 'netToOwner', visible: true, label: 'My Net' },
      { id: 'totalRevenue', visible: false, label: null },
    ];
    const merged = mergeDashboardLayout(stored, ['totalRevenue', 'netToOwner', 'costPerMile']);
    expect(merged[0]).toEqual({ id: 'netToOwner', visible: true, label: 'My Net' });
    expect(merged[1]).toEqual({ id: 'totalRevenue', visible: false, label: null });
    // missing 'costPerMile' appended at the end, visible by default (not
    // one of the redesign's hidden-by-default ids).
    expect(merged[2]).toEqual({ id: 'costPerMile', visible: true, label: null });
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
