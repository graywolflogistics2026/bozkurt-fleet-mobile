import { findDuplicateLoanGroups, findMatchingLoan, normalizeLoanKey } from '@/src/import/loanMatch';

describe('normalizeLoanKey', () => {
  test('lowercases, strips punctuation, drops stopwords/numbers, caps at 6 tokens', () => {
    expect(normalizeLoanKey('Extended Warranty')).toBe('extended warranty');
    // "REF#4471" splits on the stripped '#' into "ref" (a stopword) and
    // "4471" (a bare number) — both dropped, which is the whole point:
    // the trailing reference suffix must never survive into the key.
    expect(normalizeLoanKey('EXTENDED WARRANTY - REF#4471')).toBe('extended warranty');
    expect(normalizeLoanKey('Navistar Financial Corp — Unit 830157')).toBe('navistar financial');
  });

  test('empty/null input normalizes to an empty string', () => {
    expect(normalizeLoanKey(null)).toBe('');
    expect(normalizeLoanKey(undefined)).toBe('');
    expect(normalizeLoanKey('')).toBe('');
  });
});

describe('findMatchingLoan', () => {
  const existing = [{ id: 'loan-1', name: 'Extended Warranty', lender: null, balance: 6500, original_amount: null }];

  test('exact normalized name match', () => {
    const match = findMatchingLoan({ name: 'Extended Warranty', balance: 6000 }, existing);
    expect(match?.id).toBe('loan-1');
  });

  test('name with a trailing reference suffix still matches', () => {
    const match = findMatchingLoan({ name: 'EXTENDED WARRANTY - REF#4471', balance: 6000 }, existing);
    expect(match?.id).toBe('loan-1');
  });

  test('no match when nothing plausible exists', () => {
    const match = findMatchingLoan({ name: 'Truck Note', balance: 58000 }, existing);
    expect(match).toBeNull();
  });

  test('a wildly different balance rejects an otherwise name-matching candidate', () => {
    const match = findMatchingLoan({ name: 'Extended Warranty Truck Note', balance: 58000 }, existing);
    expect(match).toBeNull();
  });

  test('a shared name with two different recorded lenders does not match', () => {
    const withLender = [{ id: 'loan-1', name: 'Truck Loan', lender: 'Navistar Financial', balance: 40000 }];
    const match = findMatchingLoan({ name: 'Truck Loan', lender: 'Ryder Financial', balance: 40000 }, withLender);
    expect(match).toBeNull();
  });

  test('a shared name with the SAME lender matches', () => {
    const withLender = [{ id: 'loan-1', name: 'Truck Loan', lender: 'Navistar Financial', balance: 40000 }];
    const match = findMatchingLoan({ name: 'Truck Loan', lender: 'Navistar Financial', balance: 39500 }, withLender);
    expect(match?.id).toBe('loan-1');
  });

  test('no name at all never matches (nothing to key off)', () => {
    const match = findMatchingLoan({ name: null, balance: 6000 }, existing);
    expect(match).toBeNull();
  });
});

describe('findDuplicateLoanGroups', () => {
  test('groups 2+ rows sharing a normalized name, ignores singletons', () => {
    const loans = [
      { id: 'a', name: 'Extended Warranty' },
      { id: 'b', name: 'EXTENDED WARRANTY - REF#1' },
      { id: 'c', name: 'extended warranty' },
      { id: 'd', name: 'Truck Loan' },
    ];
    const groups = findDuplicateLoanGroups(loans);
    expect(groups).toHaveLength(1);
    expect(groups[0].loans.map((l) => l.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('no groups when every loan is unique', () => {
    const loans = [
      { id: 'a', name: 'Extended Warranty' },
      { id: 'b', name: 'Truck Loan' },
    ];
    expect(findDuplicateLoanGroups(loans)).toEqual([]);
  });
});
