import { buildPeriodicForecastItems, buildDocumentAmountLookup } from '../cashFlowPeriodic';
import type { ComplianceItem } from '@/src/types/db';

function complianceItem(overrides: Partial<ComplianceItem> & Pick<ComplianceItem, 'id' | 'type' | 'due_date'>): Pick<
  ComplianceItem,
  'id' | 'type' | 'label' | 'due_date' | 'source_document_id'
> {
  return {
    label: 'Item',
    source_document_id: null,
    ...overrides,
  };
}

const TODAY = new Date('2026-08-15T12:00:00Z');

describe('buildPeriodicForecastItems — a renewal inside the window lands in the right week', () => {
  it('includes a due date within the next 30 days', () => {
    const items = [complianceItem({ id: 'c1', type: 'hvut_2290', due_date: '2026-08-31', label: '2026 HVUT 2290' })];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY);
    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBe('2026-08-31');
    expect(result[0].label).toBe('2026 HVUT 2290');
  });

  it('excludes a due date outside the 30-day window (too far in the future)', () => {
    const items = [complianceItem({ id: 'c1', type: 'hvut_2290', due_date: '2026-11-30' })];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY);
    expect(result).toHaveLength(0);
  });

  it('excludes a due date already in the past', () => {
    const items = [complianceItem({ id: 'c1', type: 'hvut_2290', due_date: '2026-08-01' })];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY);
    expect(result).toHaveLength(0);
  });

  it('includes a due date exactly on the boundary (today, and today+30)', () => {
    const items = [
      complianceItem({ id: 'c1', type: 'hvut_2290', due_date: '2026-08-15' }),
      complianceItem({ id: 'c2', type: 'irp_registration', due_date: '2026-09-14' }),
    ];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY, 30);
    expect(result.map((r) => r.id).sort()).toEqual(['c1', 'c2']);
  });

  it('sorts multiple items by due date', () => {
    const items = [
      complianceItem({ id: 'later', type: 'hvut_2290', due_date: '2026-09-01' }),
      complianceItem({ id: 'sooner', type: 'irp_registration', due_date: '2026-08-20' }),
    ];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY);
    expect(result.map((r) => r.id)).toEqual(['sooner', 'later']);
  });
});

describe('buildPeriodicForecastItems — only real periodic BILL types are included', () => {
  it('excludes medical_card/cdl/drug_consortium/ifta_filing/other even when due inside the window', () => {
    const items = [
      complianceItem({ id: 'c1', type: 'medical_card', due_date: '2026-08-20' }),
      complianceItem({ id: 'c2', type: 'cdl', due_date: '2026-08-20' }),
      complianceItem({ id: 'c3', type: 'drug_consortium', due_date: '2026-08-20' }),
      complianceItem({ id: 'c4', type: 'ifta_filing', due_date: '2026-08-20' }),
      complianceItem({ id: 'c5', type: 'other', due_date: '2026-08-20' }),
      complianceItem({ id: 'c6', type: 'insurance_policy', due_date: '2026-08-20' }),
    ];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY);
    expect(result.map((r) => r.id)).toEqual(['c6']);
  });
});

describe('buildPeriodicForecastItems — amount sourcing, never invented', () => {
  it('uses the linked document\'s real amount when available', () => {
    const items = [complianceItem({ id: 'c1', type: 'hvut_2290', due_date: '2026-08-20', source_document_id: 'doc-1' })];
    const amounts = buildDocumentAmountLookup([{ id: 'doc-1', amount: 550 }]);
    const result = buildPeriodicForecastItems(items, amounts, TODAY);
    expect(result[0].amount).toBe(550);
    expect(result[0].amountSource).toBe('document');
  });

  it('is null (never guessed) when there is no linked document', () => {
    const items = [complianceItem({ id: 'c1', type: 'hvut_2290', due_date: '2026-08-20', source_document_id: null })];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY);
    expect(result[0].amount).toBeNull();
    expect(result[0].amountSource).toBeNull();
  });

  it('is null when the linked document exists but has no amount on file', () => {
    const items = [complianceItem({ id: 'c1', type: 'hvut_2290', due_date: '2026-08-20', source_document_id: 'doc-1' })];
    const result = buildPeriodicForecastItems(items, new Map(), TODAY);
    expect(result[0].amount).toBeNull();
  });
});

describe('buildDocumentAmountLookup', () => {
  it('skips a document with a null or zero amount', () => {
    const map = buildDocumentAmountLookup([
      { id: 'a', amount: null },
      { id: 'b', amount: 0 },
      { id: 'c', amount: 300 },
    ]);
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(false);
    expect(map.get('c')).toBe(300);
  });
});
