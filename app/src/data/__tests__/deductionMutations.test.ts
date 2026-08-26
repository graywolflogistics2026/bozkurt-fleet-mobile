// CASCADE DELETE (owner decision 2026-08-05, FULL PARITY pass item F.1):
// cleanupOrphanedDocument() used to only delete the `documents` DB row,
// leaving the actual uploaded file sitting in Storage forever. This tests
// the real cleanupOrphanedDocument() against an in-memory fake Supabase
// client, proving the Storage object is removed too, and that a
// still-referenced document is never touched at all.
let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import {
  cleanupOrphanedDocument,
  fetchLinkedContributionId,
  applyContributionSync,
  updateDeductionWithContributionSync,
  insertDeductionWithContributionSync,
} from '@/src/data/deductionMutations';

const USER_ID = 'user-1';

describe('cleanupOrphanedDocument (CASCADE DELETE, owner decision 2026-08-05)', () => {
  it('removes both the documents row AND its Storage object when nothing else references it', async () => {
    mockClient = createFakeSupabase({
      documents: [{ id: 'doc-1', user_id: USER_ID, storage_path: `${USER_ID}/2026-06/Receipt.jpg` }],
      deductions: [],
      settlements: [],
      maintenance_records: [],
    });

    await cleanupOrphanedDocument('doc-1');

    expect(mockClient.__store.documents).toHaveLength(0);
    expect(mockClient.__removedStoragePaths).toEqual([`${USER_ID}/2026-06/Receipt.jpg`]);
  });

  it('never removes a document still referenced by a deduction row', async () => {
    mockClient = createFakeSupabase({
      documents: [{ id: 'doc-1', user_id: USER_ID, storage_path: `${USER_ID}/2026-06/Receipt.jpg` }],
      deductions: [{ id: 'd1', user_id: USER_ID, document_id: 'doc-1' }],
      settlements: [],
      maintenance_records: [],
    });

    await cleanupOrphanedDocument('doc-1');

    expect(mockClient.__store.documents).toHaveLength(1);
    expect(mockClient.__removedStoragePaths).toEqual([]);
  });

  it('never removes a document still referenced by a settlement row', async () => {
    mockClient = createFakeSupabase({
      documents: [{ id: 'doc-1', user_id: USER_ID, storage_path: `${USER_ID}/2026-06/Statement.pdf` }],
      deductions: [],
      settlements: [{ id: 's1', user_id: USER_ID, document_id: 'doc-1' }],
      maintenance_records: [],
    });

    await cleanupOrphanedDocument('doc-1');

    expect(mockClient.__store.documents).toHaveLength(1);
  });

  it('never removes a document still referenced by a maintenance_records row', async () => {
    mockClient = createFakeSupabase({
      documents: [{ id: 'doc-1', user_id: USER_ID, storage_path: `${USER_ID}/2026-06/Invoice.jpg` }],
      deductions: [],
      settlements: [],
      maintenance_records: [{ id: 'm1', user_id: USER_ID, document_id: 'doc-1' }],
    });

    await cleanupOrphanedDocument('doc-1');

    expect(mockClient.__store.documents).toHaveLength(1);
  });

  it('a document with no storage_path removes the row without attempting a Storage call', async () => {
    mockClient = createFakeSupabase({
      documents: [{ id: 'doc-1', user_id: USER_ID, storage_path: null }],
      deductions: [],
      settlements: [],
      maintenance_records: [],
    });

    await cleanupOrphanedDocument('doc-1');

    expect(mockClient.__store.documents).toHaveLength(0);
    expect(mockClient.__removedStoragePaths).toEqual([]);
  });
});

describe('fetchLinkedContributionId / applyContributionSync (CASCADE DELETE, linked contribution)', () => {
  it('finds the single id-linked contribution for a deduction', async () => {
    mockClient = createFakeSupabase({
      capital_transactions: [
        { id: 'c1', user_id: USER_ID, tx_type: 'contribution', linked_deduction_id: 'd1' },
        { id: 'c2', user_id: USER_ID, tx_type: 'contribution', linked_deduction_id: 'd2' },
      ],
    });

    expect(await fetchLinkedContributionId(USER_ID, 'd1')).toBe('c1');
    expect(await fetchLinkedContributionId(USER_ID, 'd999')).toBeNull();
  });

  it('applyContributionSync remove action deletes the linked contribution row', async () => {
    mockClient = createFakeSupabase({
      capital_transactions: [{ id: 'c1', user_id: USER_ID, tx_type: 'contribution', linked_deduction_id: 'd1' }],
    });

    await applyContributionSync(USER_ID, 'd1', { action: 'remove', id: 'c1' });

    expect(mockClient.__store.capital_transactions).toHaveLength(0);
  });

  // FULL PARITY follow-up (owner decision 2026-08-05, spec item F.1
  // "data-loss bug" audit): the removal is scoped to the exact `id`
  // `fetchLinkedContributionId()` already resolved for THIS deduction —
  // never a scan-and-sweep of every row that happens to look orphaned.
  // Proves a manual (unlinked) cash contribution and a DIFFERENT
  // deduction's own linked contribution both survive untouched when one
  // specific deduction's contribution sync removes its own row.
  it('applyContributionSync remove action never touches a manual contribution or a different deduction\'s linked contribution', async () => {
    mockClient = createFakeSupabase({
      capital_transactions: [
        { id: 'c1', user_id: USER_ID, tx_type: 'contribution', linked_deduction_id: 'd1' },
        { id: 'c2', user_id: USER_ID, tx_type: 'contribution', linked_deduction_id: 'd2' },
        { id: 'c3', user_id: USER_ID, tx_type: 'contribution', linked_deduction_id: null, note: 'manual cash transfer' },
      ],
    });

    await applyContributionSync(USER_ID, 'd1', { action: 'remove', id: 'c1' });

    const remainingIds = mockClient.__store.capital_transactions.map((r) => r.id as string).sort();
    expect(remainingIds).toEqual(['c2', 'c3']);
  });
});

// DEDUCTION EDIT + CONTRIBUTION SYNC NOT ATOMIC (P1 fix, FULL SYSTEM
// AUDIT, docs/PENDING_SQL.md §62) — updateDeductionWithContributionSync()/
// insertDeductionWithContributionSync() exercise the REAL exported
// functions (not a reimplementation) against fakeSupabase.ts's rpc()
// mock. HONEST BOUNDARY (same as capitalTransactions.test.ts's own):
// this proves the client calls the right RPC with the right params and
// handles success/failure correctly — it cannot prove the real SQL
// transaction rolls back atomically (no Postgres runtime in this Jest
// environment). What the FAILURE-PATH tests below DO prove: on an
// injected RPC error, the fake's two writes (the deduction row, the
// capital_transactions row) NEVER run at all — the client sees one
// all-or-nothing call, not two independent steps a network drop could
// land between.
describe('updateDeductionWithContributionSync (P1 atomicity fix)', () => {
  it('updates the deduction row and creates a NEW linked contribution in one call', async () => {
    mockClient = createFakeSupabase({
      deductions: [{ id: 'd1', user_id: USER_ID, category: 'Misc', payment_method: 'Business Checking', amount: 100, tax_deductible: true }],
    });

    const result = await updateDeductionWithContributionSync({
      deductionId: 'd1',
      userId: USER_ID,
      category: 'Tools & Equipment',
      paymentMethod: 'Personal Checking',
      amount: 250,
      taxDeductible: true,
      plan: { action: 'create', amount: 250, note: 'Tools — paid personally (Personal Checking)', date: '2026-08-01' },
    });

    expect((result as { category: string }).category).toBe('Tools & Equipment');
    const dedRow = mockClient.__store.deductions.find((r) => r.id === 'd1');
    expect(dedRow?.amount).toBe(250);
    const contributions = mockClient.__store.capital_transactions ?? [];
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ tx_type: 'contribution', amount: 250, linked_deduction_id: 'd1' });
  });

  it('updates the deduction row and the EXISTING linked contribution together', async () => {
    mockClient = createFakeSupabase({
      deductions: [{ id: 'd1', user_id: USER_ID, category: 'Misc', payment_method: 'Personal Checking', amount: 100, tax_deductible: true }],
      capital_transactions: [{ id: 'c1', user_id: USER_ID, tx_type: 'contribution', amount: 100, linked_deduction_id: 'd1' }],
    });

    await updateDeductionWithContributionSync({
      deductionId: 'd1',
      userId: USER_ID,
      category: 'Misc',
      paymentMethod: 'Personal Checking',
      amount: 175,
      taxDeductible: true,
      plan: { action: 'update', id: 'c1', amount: 175, note: 'updated note', date: '2026-08-02' },
    });

    const dedRow = mockClient.__store.deductions.find((r) => r.id === 'd1');
    expect(dedRow?.amount).toBe(175);
    const contribution = mockClient.__store.capital_transactions.find((r) => r.id === 'c1');
    expect(contribution?.amount).toBe(175);
  });

  it('updates the deduction row and removes the linked contribution together (switched to business payment)', async () => {
    mockClient = createFakeSupabase({
      deductions: [{ id: 'd1', user_id: USER_ID, category: 'Misc', payment_method: 'Personal Checking', amount: 100, tax_deductible: true }],
      capital_transactions: [{ id: 'c1', user_id: USER_ID, tx_type: 'contribution', amount: 100, linked_deduction_id: 'd1' }],
    });

    await updateDeductionWithContributionSync({
      deductionId: 'd1',
      userId: USER_ID,
      category: 'Misc',
      paymentMethod: 'Business Checking',
      amount: 100,
      taxDeductible: true,
      plan: { action: 'remove', id: 'c1' },
    });

    const dedRow = mockClient.__store.deductions.find((r) => r.id === 'd1');
    expect(dedRow?.payment_method).toBe('Business Checking');
    expect(mockClient.__store.capital_transactions).toHaveLength(0);
  });

  it('a noop plan updates only the deduction row, no capital_transactions write at all', async () => {
    mockClient = createFakeSupabase({
      deductions: [{ id: 'd1', user_id: USER_ID, category: 'Misc', payment_method: 'Business Checking', amount: 100, tax_deductible: true }],
    });

    await updateDeductionWithContributionSync({
      deductionId: 'd1',
      userId: USER_ID,
      category: 'Fuel & DEF',
      paymentMethod: 'Business Checking',
      amount: 100,
      taxDeductible: true,
      plan: { action: 'noop' },
    });

    expect(mockClient.__store.deductions.find((r) => r.id === 'd1')?.category).toBe('Fuel & DEF');
    expect(mockClient.__store.capital_transactions ?? []).toHaveLength(0);
  });

  // THE ACTUAL ATOMICITY PROOF: with the old two-step client code, a
  // network drop AFTER the deduction update but BEFORE applyContributionSync()
  // left the deduction saved with a stale linked contribution. Now it's
  // ONE call — an injected failure means NEITHER write happens, proven by
  // asserting the deduction row is completely untouched (never partially
  // updated) and no capital_transactions row was created.
  it('a failed RPC call leaves BOTH the deduction and the contribution completely untouched (the reported failure path)', async () => {
    mockClient = createFakeSupabase(
      { deductions: [{ id: 'd1', user_id: USER_ID, category: 'Misc', payment_method: 'Business Checking', amount: 100, tax_deductible: true }] },
      { failures: [{ table: 'rpc:update_deduction_with_contribution_sync', error: { message: 'network drop', code: 'PGRST000' } }] }
    );

    await expect(
      updateDeductionWithContributionSync({
        deductionId: 'd1',
        userId: USER_ID,
        category: 'Tools & Equipment',
        paymentMethod: 'Personal Checking',
        amount: 999,
        taxDeductible: true,
        plan: { action: 'create', amount: 999, note: 'would-be contribution', date: '2026-08-01' },
      })
    ).rejects.toMatchObject({ code: 'PGRST000' });

    // The deduction row is EXACTLY as it was before the call — never
    // partially applied (still $100, still Business Checking, still Misc).
    const dedRow = mockClient.__store.deductions.find((r) => r.id === 'd1');
    expect(dedRow).toMatchObject({ category: 'Misc', payment_method: 'Business Checking', amount: 100 });
    // No orphaned/stale contribution was ever created either.
    expect(mockClient.__store.capital_transactions ?? []).toHaveLength(0);
  });
});

describe('insertDeductionWithContributionSync (P1 atomicity fix, add flow)', () => {
  it('inserts the deduction and creates a linked contribution together when createContribution is true', async () => {
    mockClient = createFakeSupabase({});

    const result = await insertDeductionWithContributionSync({
      userId: USER_ID,
      description: 'New tires',
      category: 'Tools & Equipment',
      paymentMethod: 'Personal Checking',
      amount: 400,
      dedDate: '2026-08-03',
      taxDeductible: true,
      createContribution: true,
      contributionNote: 'New tires — paid personally (Personal Checking)',
    });

    const dedId = (result as { id: string }).id;
    expect(mockClient.__store.deductions).toHaveLength(1);
    const contributions = mockClient.__store.capital_transactions ?? [];
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ tx_type: 'contribution', amount: 400, linked_deduction_id: dedId });
  });

  it('inserts the deduction with NO contribution when createContribution is false', async () => {
    mockClient = createFakeSupabase({});

    await insertDeductionWithContributionSync({
      userId: USER_ID,
      description: 'Office supplies',
      category: 'Misc',
      paymentMethod: 'Business Checking',
      amount: 50,
      dedDate: '2026-08-03',
      taxDeductible: true,
      createContribution: false,
    });

    expect(mockClient.__store.deductions).toHaveLength(1);
    expect(mockClient.__store.capital_transactions ?? []).toHaveLength(0);
  });

  it('a failed RPC call inserts NEITHER the deduction NOR a contribution (the add-flow failure path)', async () => {
    mockClient = createFakeSupabase(
      {},
      { failures: [{ table: 'rpc:insert_deduction_with_contribution_sync', error: { message: 'network drop', code: 'PGRST000' } }] }
    );

    await expect(
      insertDeductionWithContributionSync({
        userId: USER_ID,
        description: 'New tires',
        category: 'Tools & Equipment',
        paymentMethod: 'Personal Checking',
        amount: 400,
        dedDate: '2026-08-03',
        taxDeductible: true,
        createContribution: true,
        contributionNote: 'would-be contribution',
      })
    ).rejects.toMatchObject({ code: 'PGRST000' });

    expect(mockClient.__store.deductions ?? []).toHaveLength(0);
    expect(mockClient.__store.capital_transactions ?? []).toHaveLength(0);
  });
});
