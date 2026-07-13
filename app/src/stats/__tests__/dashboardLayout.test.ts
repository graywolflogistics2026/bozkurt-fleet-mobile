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
    // 'netToOwner'/'totalRevenue' were stored with no `section` key at all
    // (pre-dating the "Dashboard sections" addition) — falls back to each
    // id's default section (money / none).
    expect(merged[0]).toEqual({ id: 'netToOwner', visible: true, label: 'My Net', section: 'money' });
    expect(merged[1]).toEqual({ id: 'totalRevenue', visible: false, label: null, section: null });
    // missing 'costPerMile' appended at the end, visible by default (not
    // one of the redesign's hidden-by-default ids), default section
    // 'onTheRoad'.
    expect(merged[2]).toEqual({ id: 'costPerMile', visible: true, label: null, section: 'onTheRoad' });
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
    expect(merged).toEqual([{ id: 'totalRevenue', visible: false, label: 'First', section: null }]);
  });

  it('treats a malformed stored array entry as ignorable rather than throwing', () => {
    const stored = [null, { notAnId: true }, { id: 'totalRevenue', visible: true, label: null }];
    const merged = mergeDashboardLayout(stored, ['totalRevenue']);
    expect(merged).toEqual([{ id: 'totalRevenue', visible: true, label: null, section: null }]);
  });

  it('preserves an explicit stored section, including a user-chosen "no section" (null)', () => {
    const stored = [{ id: 'netToOwner', visible: true, label: null, section: 'taxes' }, { id: 'revenueExpenseTrend', visible: true, label: null, section: null }];
    const merged = mergeDashboardLayout(stored, ['netToOwner', 'revenueExpenseTrend']);
    // Moved OUT of its default 'money' section into 'taxes' by the user.
    expect(merged[0].section).toBe('taxes');
    // Explicitly cleared to "no section" — NOT the same as never having
    // been stored (which would fall back to the 'overview' default).
    expect(merged[1].section).toBeNull();
  });

  it('defaults a never-stored card to its DEFAULT_CARD_SECTIONS entry', () => {
    const merged = mergeDashboardLayout(null);
    const byId = Object.fromEntries(merged.map((m) => [m.id, m.section]));
    expect(byId.revenueExpenseTrend).toBe('overview');
    expect(byId.netToOwner).toBe('money');
    expect(byId.totalDeductions).toBe('money');
    expect(byId.perDiemSummary).toBe('onTheRoad');
    expect(byId.revenuePerMile).toBe('onTheRoad');
    expect(byId.estTotalTax).toBe('taxes');
    // Never assigned to any of the 4 sections — stays unsectioned.
    expect(byId.capitalAccountStrip).toBeNull();
    expect(byId.recentLoads).toBeNull();
  });
});
