import { buildLinkedEquipmentInsert, findMissingEquipmentBackfill, type BackfillDeductionRow, type ExistingEquipmentRow } from '@/src/import/equipmentLink';
import { EQUIPMENT_TYPE_CATEGORIES, isEquipmentTypeCategory } from '@/src/import/category';

describe('EQUIPMENT_TYPE_CATEGORIES / isEquipmentTypeCategory', () => {
  test('the durable-goods categories are recognized', () => {
    for (const c of EQUIPMENT_TYPE_CATEGORIES) {
      expect(isEquipmentTypeCategory(c)).toBe(true);
    }
  });

  test('a consumed part (Truck Parts) is deliberately NOT an equipment-type category', () => {
    expect(isEquipmentTypeCategory('Truck Parts')).toBe(false);
  });

  test('a repair/service category is not equipment-type either', () => {
    expect(isEquipmentTypeCategory('Major Repairs & Overhauls')).toBe(false);
    expect(isEquipmentTypeCategory('Warranty & Service Contracts')).toBe(false);
  });

  test('null/undefined/unrecognized never match', () => {
    expect(isEquipmentTypeCategory(null)).toBe(false);
    expect(isEquipmentTypeCategory(undefined)).toBe(false);
    expect(isEquipmentTypeCategory('Fuel & DEF')).toBe(false);
  });
});

describe('buildLinkedEquipmentInsert', () => {
  test('a Tools & Equipment deduction line produces a real, linked Equipment insert', () => {
    const result = buildLinkedEquipmentInsert(
      { category: 'Tools & Equipment', description: 'Impact Wrench Kit', amount: 189.99, ded_date: '2026-06-01', store: 'Harbor Freight' },
      'ded-1',
      'user-1'
    );
    expect(result).toEqual({
      user_id: 'user-1',
      name: 'Impact Wrench Kit',
      category: 'Tools & Equipment',
      purchase_price: 189.99,
      purchase_date: '2026-06-01',
      vendor: 'Harbor Freight',
      linked_deduction_id: 'ded-1',
    });
  });

  test('a non-equipment category never produces an insert', () => {
    expect(buildLinkedEquipmentInsert({ category: 'Fuel & DEF', description: 'Diesel', amount: 100, ded_date: null, store: null }, 'ded-2', 'user-1')).toBeNull();
    expect(buildLinkedEquipmentInsert({ category: null, description: 'Diesel', amount: 100, ded_date: null, store: null }, 'ded-2', 'user-1')).toBeNull();
  });

  test('a blank description falls back to the category name, never an empty title', () => {
    const result = buildLinkedEquipmentInsert({ category: 'Electronics', description: '   ', amount: 50, ded_date: null, store: null }, 'ded-3', 'user-1');
    expect(result?.name).toBe('Electronics');
  });

  test('a blank store never produces an empty-string vendor', () => {
    const result = buildLinkedEquipmentInsert({ category: 'Safety Gear & Workwear', description: 'Steel-toe boots', amount: 80, ded_date: null, store: '   ' }, 'ded-4', 'user-1');
    expect(result?.vendor).toBeNull();
  });
});

describe('findMissingEquipmentBackfill', () => {
  const equipmentRow = (category: string, id: string, description = 'Item', amount = 100, date = '2026-01-01'): BackfillDeductionRow => ({
    id,
    category,
    description,
    amount,
    ded_date: date,
    store: 'Store',
  });

  test('a non-equipment-category deduction is never included', () => {
    const result = findMissingEquipmentBackfill([equipmentRow('Fuel & DEF', 'd1')], []);
    expect(result).toEqual([]);
  });

  test('a deduction already linked (by linked_deduction_id) is excluded', () => {
    const existing: ExistingEquipmentRow[] = [{ linked_deduction_id: 'd1', name: 'Item', purchase_price: 100, purchase_date: '2026-01-01' }];
    const result = findMissingEquipmentBackfill([equipmentRow('Tools & Equipment', 'd1')], existing);
    expect(result).toEqual([]);
  });

  test('a deduction with a fuzzy-matching pre-existing equipment row (same name+amount+date, no link) is excluded — defends against a row created some other way before this feature existed', () => {
    const existing: ExistingEquipmentRow[] = [{ linked_deduction_id: null, name: 'Item', purchase_price: 100, purchase_date: '2026-01-01' }];
    const result = findMissingEquipmentBackfill([equipmentRow('Tools & Equipment', 'd1')], existing);
    expect(result).toEqual([]);
  });

  test('a genuinely unlinked, unmatched deduction IS included', () => {
    const result = findMissingEquipmentBackfill([equipmentRow('Comfort & Sleeper', 'd1', 'Memory Foam Mattress', 250, '2026-03-01')], []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('d1');
  });

  test('never duplicates one already-covered row while still finding a genuinely new one in the same batch', () => {
    const existing: ExistingEquipmentRow[] = [{ linked_deduction_id: 'd1', name: 'Item', purchase_price: 100, purchase_date: '2026-01-01' }];
    const rows = [equipmentRow('Tools & Equipment', 'd1'), equipmentRow('Electronics', 'd2', 'Dash Cam', 75, '2026-02-01')];
    const result = findMissingEquipmentBackfill(rows, existing);
    expect(result.map((r) => r.id)).toEqual(['d2']);
  });
});
