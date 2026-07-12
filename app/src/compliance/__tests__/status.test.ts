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
