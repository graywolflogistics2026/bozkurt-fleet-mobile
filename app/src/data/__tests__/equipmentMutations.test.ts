// EQUIPMENT AUTO-POPULATE — BIDIRECTIONAL DELETE (owner decision,
// SIMPLIFICATION PASS, item 7.4): proves the REAL
// deleteEquipmentWithLinkedDeduction() (equipment.tsx's own delete
// handler calls this, unmodified) against an in-memory fake Supabase
// client — not a reimplementation of the delete logic.
let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { deleteEquipmentWithLinkedDeduction } from '@/src/data/equipmentMutations';

const USER_ID = 'user-1';

describe('deleteEquipmentWithLinkedDeduction', () => {
  test('deleting an Equipment row with a linked deduction removes BOTH rows', async () => {
    mockClient = createFakeSupabase({
      deductions: [{ id: 'ded-1', user_id: USER_ID, category: 'Tools & Equipment', description: 'Impact Wrench', amount: 189.99 }],
      equipment: [{ id: 'eq-1', user_id: USER_ID, name: 'Impact Wrench', linked_deduction_id: 'ded-1' }],
    });

    const result = await deleteEquipmentWithLinkedDeduction('eq-1', 'ded-1');

    expect(result.linkedDeductionDeleteFailed).toBe(false);
    expect(mockClient.__store.equipment ?? []).toHaveLength(0);
    expect(mockClient.__store.deductions ?? []).toHaveLength(0);
  });

  test('deleting a manually-added Equipment row with no linked deduction only removes the Equipment row', async () => {
    mockClient = createFakeSupabase({
      deductions: [{ id: 'ded-unrelated', user_id: USER_ID, category: 'Fuel & DEF', description: 'Diesel', amount: 400 }],
      equipment: [{ id: 'eq-1', user_id: USER_ID, name: 'Generator', linked_deduction_id: null }],
    });

    const result = await deleteEquipmentWithLinkedDeduction('eq-1', null);

    expect(result.linkedDeductionDeleteFailed).toBe(false);
    expect(mockClient.__store.equipment ?? []).toHaveLength(0);
    expect(mockClient.__store.deductions ?? []).toHaveLength(1); // the unrelated deduction survives untouched
  });

  test('a linked-deduction delete failure is reported, never thrown — the Equipment row deletion (already committed) is not undone', async () => {
    mockClient = createFakeSupabase(
      {
        deductions: [{ id: 'ded-1', user_id: USER_ID, category: 'Tools & Equipment', description: 'Impact Wrench', amount: 189.99 }],
        equipment: [{ id: 'eq-1', user_id: USER_ID, name: 'Impact Wrench', linked_deduction_id: 'ded-1' }],
      },
      { failures: [{ table: 'deductions', mode: 'delete', error: { message: 'db error' } }] }
    );

    const result = await deleteEquipmentWithLinkedDeduction('eq-1', 'ded-1');

    expect(result.linkedDeductionDeleteFailed).toBe(true);
    expect(mockClient.__store.equipment ?? []).toHaveLength(0); // still deleted
    expect(mockClient.__store.deductions).toHaveLength(1); // the failed delete left it in place
  });

  test('deleting the DEDUCTION side (not this function) cascades to remove its linked Equipment row automatically, at the DB level — the other half of the bidirectional requirement', async () => {
    mockClient = createFakeSupabase({
      deductions: [{ id: 'ded-1', user_id: USER_ID, category: 'Tools & Equipment', description: 'Impact Wrench', amount: 189.99 }],
      equipment: [{ id: 'eq-1', user_id: USER_ID, name: 'Impact Wrench', linked_deduction_id: 'ded-1' }],
    });

    const { error } = await mockClient.from('deductions').delete().eq('id', 'ded-1');

    expect(error).toBeNull();
    expect(mockClient.__store.deductions ?? []).toHaveLength(0);
    expect(mockClient.__store.equipment ?? []).toHaveLength(0);
  });
});
