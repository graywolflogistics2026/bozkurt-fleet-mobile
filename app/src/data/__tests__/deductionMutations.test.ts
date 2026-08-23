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
import { cleanupOrphanedDocument, fetchLinkedContributionId, applyContributionSync } from '@/src/data/deductionMutations';

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
});
