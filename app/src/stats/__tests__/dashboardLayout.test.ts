import {
  mergeDashboardLayout,
  isDefaultLayout,
  DEFAULT_CARD_ORDER,
  DASHBOARD_CARD_ROUTES,
  buildCustomizedDashboardBlocks,
  type DashboardCardConfig,
} from '@/src/stats/dashboardLayout';

// UX MEGA-PASS item A (owner decision 2026-07-31, device evidence: "per
// diem card opens Tax Estimator", "Recent Loads opens Cash Flow" — wrong
// destinations). Regression guard for the exact reported bugs, plus a
// general sanity check that every route in the table is a plausible app
// route (starts with the tabs group) so a future typo fails a test
// instead of shipping a dead link.
describe('DASHBOARD_CARD_ROUTES', () => {
  it('routes per diem cards to Settlements (where per_diem_days actually lives), not Tax Estimator', () => {
    expect(DASHBOARD_CARD_ROUTES.ytdPerDiemDays).toBe('/(tabs)/more/settlements');
    expect(DASHBOARD_CARD_ROUTES.perDiemDeduction).toBe('/(tabs)/more/settlements');
    expect(DASHBOARD_CARD_ROUTES.perDiemSummary).toBe('/(tabs)/more/settlements');
  });

  it('routes Recent Loads to the Loads screen, not Cash Flow', () => {
    expect(DASHBOARD_CARD_ROUTES.recentLoads).toBe('/(tabs)/more/loads');
  });

  it('routes revenue/deduction/net cards to their matching detail screens', () => {
    expect(DASHBOARD_CARD_ROUTES.totalRevenue).toBe('/(tabs)/more/cash-flow');
    expect(DASHBOARD_CARD_ROUTES.netToOwner).toBe('/(tabs)/more/cash-flow');
    expect(DASHBOARD_CARD_ROUTES.totalDeductions).toBe('/(tabs)/deductions');
  });

  it('every registered route starts with the (tabs) group segment', () => {
    for (const [id, route] of Object.entries(DASHBOARD_CARD_ROUTES)) {
      expect(route!.startsWith('/(tabs)/')).toBe(true);
    }
  });
});

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

  // CRASH-ON-MOUNT FIX (owner decision 2026-07-30) — suspect (c) in the
  // requested hunt order: dashboard_layout is a `jsonb` column
  // (docs/SCHEMA.sql), so PostgREST already hands back a parsed JS value
  // and this codebase never calls JSON.parse on it anywhere. These tests
  // prove mergeDashboardLayout() never throws regardless of what a
  // post-reset, corrupted, or otherwise unexpected stored value looks
  // like — every one of these falls through the `Array.isArray` check to
  // the full, safe default layout without ever attempting to parse.
  it('never throws and falls back to the full default layout for every non-array stored shape', () => {
    const badValues: unknown[] = [null, undefined, '', '{}', '[]', 'not json at all {{{', 0, false, {}, 'null'];
    for (const bad of badValues) {
      expect(() => mergeDashboardLayout(bad)).not.toThrow();
      const merged = mergeDashboardLayout(bad);
      expect(merged.map((m) => m.id)).toEqual([...DEFAULT_CARD_ORDER]);
    }
  });

});

// CRITICAL BUG FIX (device feedback 2026-07-31, "5th report": "using the
// arrows/toggles in the Simple editor changes NOTHING on Home"). Root
// cause: Home used to always render the 4 sections in the fixed
// SECTION_IDS order (plus unsectioned cards always trailing last),
// completely ignoring WHERE in the user's own flat, reordered list those
// sections' cards actually landed — so reordering two cards from
// different default sections (the common case) was invisible on Home even
// though the save/refetch path worked. buildCustomizedDashboardBlocks()
// orders the rendered blocks by each block's earliest member's position
// in the flat list instead.
describe('buildCustomizedDashboardBlocks', () => {
  function row(id: string, section: DashboardCardConfig['section']): DashboardCardConfig {
    return { id, visible: true, label: null, section };
  }

  it('groups same-section cards into one block, in their relative order', () => {
    const visible = [row('netToOwner', 'money'), row('totalDeductions', 'money')];
    const blocks = buildCustomizedDashboardBlocks(visible);
    expect(blocks).toEqual([{ section: 'money', rows: visible }]);
  });

  it('orders blocks by the flat position of their first member — reordering across sections actually moves things', () => {
    // Default-ish order: an 'overview' card, then a 'money' card.
    const defaultish = [row('revenueExpenseTrend', 'overview'), row('netToOwner', 'money')];
    expect(buildCustomizedDashboardBlocks(defaultish).map((b) => b.section)).toEqual(['overview', 'money']);

    // User drags the 'money' card above the 'overview' card in the Simple
    // editor's single flat list — the BLOCK order must flip too.
    const reordered = [row('netToOwner', 'money'), row('revenueExpenseTrend', 'overview')];
    expect(buildCustomizedDashboardBlocks(reordered).map((b) => b.section)).toEqual(['money', 'overview']);
  });

  it('treats an unsectioned card as its own singleton block, positioned by its own flat index', () => {
    const visible = [row('recentLoads', null), row('netToOwner', 'money')];
    const blocks = buildCustomizedDashboardBlocks(visible);
    expect(blocks).toEqual([
      { section: null, rows: [row('recentLoads', null)] },
      { section: 'money', rows: [row('netToOwner', 'money')] },
    ]);

    // Move the unsectioned card AFTER the sectioned one — block order flips.
    const reordered = [row('netToOwner', 'money'), row('recentLoads', null)];
    expect(buildCustomizedDashboardBlocks(reordered).map((b) => b.section)).toEqual(['money', null]);
  });

  it('an empty visible list produces no blocks', () => {
    expect(buildCustomizedDashboardBlocks([])).toEqual([]);
  });
});

describe('mergeDashboardLayout section defaults (continued)', () => {
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
