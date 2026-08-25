import { calcComplianceStatus, sortByDueDate, DEFAULT_RECURRENCE, COMPLIANCE_TYPES } from '@/src/compliance/status';
import type { ComplianceItem } from '@/src/types/db';

function item(overrides: Partial<ComplianceItem>): ComplianceItem {
  return {
    id: 'item-1',
    user_id: 'user-1',
    type: 'hvut_2290',
    label: 'HVUT (Form 2290)',
    due_date: '2026-08-01',
    recurrence: null,
    source_document_id: null,
    issue_date: null,
    reminder_lead_days: null,
    note: null,
    truck_id: null,
    driver_id: null,
    applies_to: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('calcComplianceStatus', () => {
  it('is "ok" (green) when well beyond the 30-day due-soon threshold', () => {
    const { urgency, daysUntil } = calcComplianceStatus('2026-09-01', new Date('2026-07-01T00:00:00'));
    expect(daysUntil).toBe(62);
    expect(urgency).toBe('ok');
  });

  it('is "due_soon" (orange) at exactly 30 days out', () => {
    const { urgency, daysUntil } = calcComplianceStatus('2026-07-31', new Date('2026-07-01T00:00:00'));
    expect(daysUntil).toBe(30);
    expect(urgency).toBe('due_soon');
  });

  it('is "due_soon" (orange) at 1 day out — not yet overdue', () => {
    const { urgency, daysUntil } = calcComplianceStatus('2026-07-02', new Date('2026-07-01T00:00:00'));
    expect(daysUntil).toBe(1);
    expect(urgency).toBe('due_soon');
  });

  it('is "due_soon" (orange), not overdue, on the due date itself (0 days out)', () => {
    const { urgency, daysUntil } = calcComplianceStatus('2026-07-01', new Date('2026-07-01T00:00:00'));
    expect(daysUntil).toBe(0);
    expect(urgency).toBe('due_soon');
  });

  it('is "overdue" (red) the day after the due date', () => {
    const { urgency, daysUntil } = calcComplianceStatus('2026-06-30', new Date('2026-07-01T00:00:00'));
    expect(daysUntil).toBe(-1);
    expect(urgency).toBe('overdue');
  });

  it('stays "overdue" arbitrarily far in the past, not some other status', () => {
    const { urgency, daysUntil } = calcComplianceStatus('2025-01-01', new Date('2026-07-01T00:00:00'));
    expect(daysUntil).toBeLessThan(-300);
    expect(urgency).toBe('overdue');
  });

  it('flips from "ok" to "due_soon" exactly at the 31-vs-30-day boundary', () => {
    const justOutside = calcComplianceStatus('2026-08-01', new Date('2026-07-01T00:00:00'));
    expect(justOutside.daysUntil).toBe(31);
    expect(justOutside.urgency).toBe('ok');

    const justInside = calcComplianceStatus('2026-07-31', new Date('2026-07-01T00:00:00'));
    expect(justInside.daysUntil).toBe(30);
    expect(justInside.urgency).toBe('due_soon');
  });

  // DOCUMENTS & RENEWALS EXPANSION (owner decision 2026-08-24, device
  // testing round, item 3) — "manual items get the same expiry alerts as
  // built-in ones" is proven here: a manual item's own reminder_lead_days
  // is just the SAME urgency function every built-in item already uses,
  // with one extra optional argument. Null/undefined behaves EXACTLY like
  // before this pass (the app-wide 30-day default) — nothing regresses for
  // any row that never sets this new column.
  describe('reminderLeadDays (per-item override)', () => {
    it('null/undefined behaves identically to the app-wide 30-day default', () => {
      const withNull = calcComplianceStatus('2026-07-31', new Date('2026-07-01T00:00:00'), null);
      const withUndefined = calcComplianceStatus('2026-07-31', new Date('2026-07-01T00:00:00'), undefined);
      const omitted = calcComplianceStatus('2026-07-31', new Date('2026-07-01T00:00:00'));
      expect(withNull).toEqual(omitted);
      expect(withUndefined).toEqual(omitted);
      expect(withNull.urgency).toBe('due_soon');
    });

    it('a manual item with a SHORTER custom lead time (e.g. 7 days) stays "ok" until it is actually within 7 days', () => {
      // 30 days out — would be "due_soon" under the default threshold, but
      // this item's own 7-day reminder means it is not due_soon yet.
      const result = calcComplianceStatus('2026-07-31', new Date('2026-07-01T00:00:00'), 7);
      expect(result.daysUntil).toBe(30);
      expect(result.urgency).toBe('ok');
    });

    it('a manual item with a shorter custom lead time flips to "due_soon" once inside its own window', () => {
      const result = calcComplianceStatus('2026-07-08', new Date('2026-07-01T00:00:00'), 7);
      expect(result.daysUntil).toBe(7);
      expect(result.urgency).toBe('due_soon');
    });

    it('a manual item with a LONGER custom lead time (e.g. 60 days) goes due_soon earlier than the default would', () => {
      const result = calcComplianceStatus('2026-08-15', new Date('2026-07-01T00:00:00'), 60);
      expect(result.daysUntil).toBe(45);
      expect(result.urgency).toBe('due_soon');
      // The same date/now with the default threshold would still be "ok".
      expect(calcComplianceStatus('2026-08-15', new Date('2026-07-01T00:00:00')).urgency).toBe('ok');
    });

    it('overdue is always overdue regardless of any custom lead time', () => {
      expect(calcComplianceStatus('2026-06-30', new Date('2026-07-01T00:00:00'), 7).urgency).toBe('overdue');
      expect(calcComplianceStatus('2026-06-30', new Date('2026-07-01T00:00:00'), 90).urgency).toBe('overdue');
    });
  });
});

describe('sortByDueDate', () => {
  it('sorts soonest-due first, overdue items ahead of everything else', () => {
    const items = [
      item({ id: 'far', due_date: '2027-01-01' }),
      item({ id: 'overdue', due_date: '2026-01-01' }),
      item({ id: 'soon', due_date: '2026-07-15' }),
    ];
    const sorted = sortByDueDate(items);
    expect(sorted.map((i) => i.id)).toEqual(['overdue', 'soon', 'far']);
  });

  it('does not mutate the input array', () => {
    const items = [item({ id: 'b', due_date: '2026-02-01' }), item({ id: 'a', due_date: '2026-01-01' })];
    const original = [...items];
    sortByDueDate(items);
    expect(items).toEqual(original);
  });
});

describe('DEFAULT_RECURRENCE', () => {
  it('has a default for every compliance type', () => {
    for (const type of COMPLIANCE_TYPES) {
      expect(DEFAULT_RECURRENCE[type]).toBeDefined();
    }
  });

  it('defaults HVUT 2290 to annual and IFTA filing to quarterly, per PROMPTS.md', () => {
    expect(DEFAULT_RECURRENCE.hvut_2290).toBe('annual');
    expect(DEFAULT_RECURRENCE.ifta_filing).toBe('quarterly');
  });
});
