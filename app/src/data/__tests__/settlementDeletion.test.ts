// SETTLEMENT DELETE ORPHANS (owner decision, docs/PENDING_SQL.md §70) —
// exercises the REAL delete sequence app/(tabs)/more/settlements.tsx's
// handleDelete() performs (a plain `.delete()` on settlements, then
// cleanupOrphanedDocument() on its own document_id) against
// fakeSupabase.ts's in-memory client, which now simulates BOTH the
// documented `on delete cascade`/`on delete set null` FK graph AND the
// new `reverse_settlement_business_balance_credit()` AFTER DELETE
// trigger (docs/PENDING_SQL.md §70) — so "deleting a settlement reverses
// its balance credit, removes every child row, cleans up its document,
// and unlinks (never deletes) any loan it touched" is proven against
// real code paths, not asserted by hand.
//
// HONEST BOUNDARY, same as every other fake in this file: this proves
// the app's OWN delete flow is correct — it cannot prove the LIVE
// Postgres trigger/FK constraints are actually configured this way (no
// Postgres runtime in this environment); docs/PENDING_SQL.md §70 must
// actually be run for the real behavior to exist.

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import { checkDuplicateImport } from '@/src/import/duplicateCheck';
import type { ExistingDocSummary } from '@/src/import/duplicateCheck';
import type { Extraction } from '@/src/import/types';

const USER_ID = 'user-1';
const SETTLEMENT_ID = 'sett-1';
const DOCUMENT_ID = 'doc-sett-1';

// A realistic saved settlement with one row in every child table §70
// touches, plus a loan its own extraction upserted and a manual
// (non-linked) capital contribution already on the books — the exact
// shape a real device account would have.
function seedFullSettlement() {
  return {
    profiles: [{ user_id: USER_ID, business_balance: 61897, initial_capital: 0 }],
    settlements: [
      {
        id: SETTLEMENT_ID,
        user_id: USER_ID,
        truck_id: null,
        week_ending: '2026-06-06',
        gross: 5000,
        net: 4200,
        document_id: DOCUMENT_ID,
        business_balance_credit: 4200,
      },
    ],
    documents: [
      {
        id: DOCUMENT_ID,
        user_id: USER_ID,
        storage_path: `${USER_ID}/2026-06/Settlements/settlement.pdf`,
        doc_type: 'settlement',
        doc_date: '2026-06-06',
        amount: 5000,
        filename: 'settlement.pdf',
        imported_at: '2026-06-07T00:00:00Z',
      },
    ],
    loads: [{ id: 'load-1', user_id: USER_ID, settlement_id: SETTLEMENT_ID, revenue: 5000 }],
    fuel_purchases: [{ id: 'fuel-1', user_id: USER_ID, settlement_id: SETTLEMENT_ID, amount: 400 }],
    reimbursements: [{ id: 'reimb-1', user_id: USER_ID, settlement_id: SETTLEMENT_ID, amount: 50 }],
    deductions: [{ id: 'ded-1', user_id: USER_ID, settlement_id: SETTLEMENT_ID, amount: 300, category: 'Insurance—Truck', source: 'settlement' }],
    maintenance_records: [{ id: 'maint-1', user_id: USER_ID, settlement_id: SETTLEMENT_ID, cost: 50, source: 'settlement' }],
    tolls: [{ id: 'toll-1', user_id: USER_ID, settlement_id: SETTLEMENT_ID, amount: 25, source: 'settlement' }],
    loans: [{ id: 'loan-1', user_id: USER_ID, name: 'Truck payment', settlement_id: SETTLEMENT_ID, source: 'settlement', balance: 40000 }],
    // A DIFFERENT, unrelated manual contribution — must survive untouched.
    capital_transactions: [{ id: 'ctx-1', user_id: USER_ID, tx_type: 'contribution', amount: 60000, tx_date: '2026-01-01', linked_deduction_id: null }],
  };
}

// Mirrors app/(tabs)/more/settlements.tsx's handleDelete() exactly:
// capture document_id, delete the settlement, clean up its document.
async function deleteSettlementLikeTheScreenDoes(settlementId: string, documentId: string | null) {
  const { error } = await mockClient.from('settlements').delete().eq('id', settlementId);
  if (error) throw error;
  if (documentId) await cleanupOrphanedDocument(documentId);
}

describe('deleting a settlement — balance reversal', () => {
  it('import then delete returns business_balance to EXACTLY its prior value', async () => {
    mockClient = createFakeSupabase(seedFullSettlement());
    // The "prior value" — what business_balance was BEFORE this
    // settlement's own $4,200 net pay was ever credited.
    const priorValue = 61897 - 4200;

    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    const profile = mockClient.__store.profiles!.find((p) => p.user_id === USER_ID);
    expect(profile!.business_balance).toBe(priorValue);
  });

  it('no derived rows remain in any child table', async () => {
    mockClient = createFakeSupabase(seedFullSettlement());
    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    expect(mockClient.__store.settlements).toHaveLength(0);
    expect(mockClient.__store.loads).toHaveLength(0);
    expect(mockClient.__store.fuel_purchases).toHaveLength(0);
    expect(mockClient.__store.reimbursements).toHaveLength(0);
    expect(mockClient.__store.deductions).toHaveLength(0);
    expect(mockClient.__store.maintenance_records).toHaveLength(0);
    expect(mockClient.__store.tolls).toHaveLength(0);
  });

  it('no documents row or Storage file remains', async () => {
    mockClient = createFakeSupabase(seedFullSettlement());
    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    expect(mockClient.__store.documents).toHaveLength(0);
    expect(mockClient.__removedStoragePaths).toEqual([`${USER_ID}/2026-06/Settlements/settlement.pdf`]);
  });

  it('re-importing the same file is accepted — no longer flagged as a duplicate', async () => {
    mockClient = createFakeSupabase(seedFullSettlement());
    const extraction: Extraction = { docType: 'settlement', date: '', totalAmount: 5000, settlement: { weekEnding: '2026-06-06' } };

    // BEFORE delete: genuinely a duplicate (the settlement's own document
    // is still on file) — proves the check itself works, not just that
    // it always says "no."
    const beforeDocs = (mockClient.__store.documents ?? []) as unknown as ExistingDocSummary[];
    const before = checkDuplicateImport(extraction, 'settlement.pdf', beforeDocs);
    expect(before.byContent.length).toBeGreaterThan(0);

    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    const afterDocs = (mockClient.__store.documents ?? []) as unknown as ExistingDocSummary[];
    const after = checkDuplicateImport(extraction, 'settlement.pdf', afterDocs);
    expect(after.byContent).toEqual([]);
    expect(after.byFilename).toEqual([]);
  });

  it('a loan the settlement touched survives, unlinked (settlement_id -> null) but still marked source="settlement"', async () => {
    mockClient = createFakeSupabase(seedFullSettlement());
    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    const loan = mockClient.__store.loans!.find((l) => l.id === 'loan-1');
    expect(loan).toBeDefined();
    expect(loan!.balance).toBe(40000); // the real, standing loan balance is untouched
    expect(loan!.settlement_id).toBeNull();
    expect(loan!.source).toBe('settlement'); // provenance survives even after unlinking
  });

  it('an unrelated manual capital contribution is completely untouched', async () => {
    mockClient = createFakeSupabase(seedFullSettlement());
    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    expect(mockClient.__store.capital_transactions).toHaveLength(1);
    expect(mockClient.__store.capital_transactions![0].id).toBe('ctx-1');
    expect(mockClient.__store.capital_transactions![0].amount).toBe(60000);
  });

  it('a settlement with zero credit (e.g. already fully reversed once, or a $0 net week) leaves the balance untouched', async () => {
    const seed = seedFullSettlement();
    seed.settlements[0].business_balance_credit = 0;
    mockClient = createFakeSupabase(seed);

    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    const profile = mockClient.__store.profiles!.find((p) => p.user_id === USER_ID);
    expect(profile!.business_balance).toBe(61897);
  });

  it('a NEGATIVE net-pay week (the owner owed the carrier) reverses correctly — balance goes back UP', async () => {
    const seed = seedFullSettlement();
    seed.settlements[0].business_balance_credit = -1155.35;
    seed.profiles[0].business_balance = 10000 - 1155.35;
    mockClient = createFakeSupabase(seed);

    await deleteSettlementLikeTheScreenDoes(SETTLEMENT_ID, DOCUMENT_ID);

    const profile = mockClient.__store.profiles!.find((p) => p.user_id === USER_ID);
    expect(profile!.business_balance).toBeCloseTo(10000, 5);
  });
});

describe('personally-paid expenses never touch the bank balance (item 5)', () => {
  it('a linked (personal-payment) capital contribution leaves business_balance completely unchanged, both on create and on the settlement delete path', async () => {
    // A personally-paid deduction with its own LINKED contribution —
    // exactly what CLAUDE.md invariant #2's confirmation flow creates.
    // This is never reachable from a settlement-withheld row (the
    // isPersonalPayment branch in aiImportSave.ts only ever fires for
    // amazon/store docTypes), so it's seeded directly here to prove the
    // INVARIANT itself: a linked contribution's own insert never applies
    // a business_balance delta, unlike a manual one.
    mockClient = createFakeSupabase({
      profiles: [{ user_id: USER_ID, business_balance: 55000 }],
      deductions: [{ id: 'ded-personal', user_id: USER_ID, amount: 200, payment_method: 'Personal Checking', source: 'import' }],
      capital_transactions: [],
    });

    const { error } = await mockClient.from('capital_transactions').insert({
      user_id: USER_ID,
      tx_type: 'contribution',
      amount: 200,
      tx_date: '2026-06-06',
      linked_deduction_id: 'ded-personal',
      note: 'Truck part — paid personally (Personal Checking)',
    });
    expect(error).toBeNull();

    const profile = mockClient.__store.profiles!.find((p) => p.user_id === USER_ID);
    // The whole point: real cash never entered the business account for
    // a personally-paid purchase — only the contribution/tax-free base
    // moves, never business_balance.
    expect(profile!.business_balance).toBe(55000);

    // Deleting the deduction it's linked to (cascade) still never
    // touches business_balance either.
    await mockClient.from('deductions').delete().eq('id', 'ded-personal');
    expect(mockClient.__store.capital_transactions).toHaveLength(0); // cascaded
    expect(profile!.business_balance).toBe(55000);
  });
});
