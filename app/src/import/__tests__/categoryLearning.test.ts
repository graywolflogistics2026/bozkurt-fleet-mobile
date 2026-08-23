import {
  normalizeKeyword,
  matchLearnedCategory,
  applyLearnedCategories,
  buildUserCorrectionsPromptText,
  type LearningRule,
} from '@/src/import/categoryLearning';

describe('normalizeKeyword', () => {
  it('lowercases, strips punctuation, and drops standalone numeric tokens', () => {
    expect(normalizeKeyword('AMAZON.COM ORDER #123-4567')).toBe('amazon com order');
  });

  it('drops common stopwords', () => {
    expect(normalizeKeyword('The Home Depot Inc Purchase')).toBe('home depot');
  });

  it('caps at the given max token count', () => {
    expect(normalizeKeyword('Pilot Flying J Travel Center Fuel', 2)).toBe('pilot flying');
  });

  it('returns empty string for null/empty input', () => {
    expect(normalizeKeyword(null)).toBe('');
    expect(normalizeKeyword('')).toBe('');
  });
});

describe('matchLearnedCategory (spec item G, fuzzy matching)', () => {
  const rules: LearningRule[] = [
    { keyword: 'amazon com order', category: 'Office Supplies' },
    { keyword: 'walmart', category: 'Tools & Equipment' },
  ];

  it('returns null when there are no rules or no description', () => {
    expect(matchLearnedCategory('Amazon.com', [])).toBeNull();
    expect(matchLearnedCategory(null, rules)).toBeNull();
  });

  it('matches exactly when the normalized description equals a learned keyword', () => {
    expect(matchLearnedCategory('Walmart', rules)).toBe('Tools & Equipment');
  });

  it('matches when the new description is a superset (a different order number)', () => {
    expect(matchLearnedCategory('AMAZON.COM ORDER #987-6543', rules)).toBe('Office Supplies');
  });

  it('fuzzy-matches a typo/OCR-damaged vendor name within the distance threshold', () => {
    // "walrnart" (OCR m->rn) is within 25% edit distance of "walmart"
    expect(matchLearnedCategory('Walrnart', rules)).toBe('Tools & Equipment');
  });

  it('does not match an unrelated vendor', () => {
    expect(matchLearnedCategory('Pilot Flying J', rules)).toBeNull();
  });
});

describe('applyLearnedCategories', () => {
  const rules: LearningRule[] = [{ keyword: 'amazon com', category: 'Office Supplies' }];

  it('overrides the category on a matching row', () => {
    const rows = [{ description: 'Amazon.com Order #1', category: 'Other' }];
    const result = applyLearnedCategories(rows, rules);
    expect(result[0].category).toBe('Office Supplies');
  });

  it('leaves a non-matching row unchanged', () => {
    const rows = [{ description: 'Shell Gas Station', category: 'Fuel & DEF' }];
    const result = applyLearnedCategories(rows, rules);
    expect(result[0].category).toBe('Fuel & DEF');
  });

  it('is a no-op pass-through when there are no rules', () => {
    const rows = [{ description: 'Amazon.com', category: 'Other' }];
    expect(applyLearnedCategories(rows, [])).toBe(rows);
  });
});

describe('buildUserCorrectionsPromptText', () => {
  it('returns an empty string when there are no rules', () => {
    expect(buildUserCorrectionsPromptText([])).toBe('');
  });

  it('lists every rule as a hint line', () => {
    const text = buildUserCorrectionsPromptText([
      { keyword: 'amazon com', category: 'Office Supplies' },
      { keyword: 'walmart', category: 'Tools & Equipment' },
    ]);
    expect(text).toContain('USER CORRECTIONS');
    expect(text).toContain('"amazon com" -> Office Supplies');
    expect(text).toContain('"walmart" -> Tools & Equipment');
  });

  it('caps at 30 rules to keep the prompt bounded', () => {
    const many: LearningRule[] = Array.from({ length: 40 }, (_, i) => ({ keyword: `vendor${i}`, category: 'Other' }));
    const text = buildUserCorrectionsPromptText(many);
    const lines = text.split('\n').filter((l) => l.startsWith('- "'));
    expect(lines).toHaveLength(30);
  });
});
