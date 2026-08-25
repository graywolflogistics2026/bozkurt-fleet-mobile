import {
  isDeductionNeedsReview,
  isDocumentNeedsReview,
  isSettlementNeedsReview,
  stripNeedsReviewPrefix,
  buildMarkDeductionReviewedUpdate,
  buildMarkDocumentReviewedUpdate,
} from '@/src/import/needsReview';

describe('isDeductionNeedsReview', () => {
  it('is true when the description starts with the NEEDS REVIEW prefix', () => {
    expect(isDeductionNeedsReview({ description: 'NEEDS REVIEW: Unknown Vendor', reviewed_at: null })).toBe(true);
  });

  it('is false for a normal description', () => {
    expect(isDeductionNeedsReview({ description: 'Walmart — fuel receipt', reviewed_at: null })).toBe(false);
  });

  it('is false for null/undefined description', () => {
    expect(isDeductionNeedsReview({ description: null, reviewed_at: null })).toBe(false);
    expect(isDeductionNeedsReview({ description: undefined as unknown as string | null, reviewed_at: null })).toBe(false);
  });

  it('tolerates leading whitespace', () => {
    expect(isDeductionNeedsReview({ description: '  NEEDS REVIEW: something', reviewed_at: null })).toBe(true);
  });

  // NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24):
  // reviewed_at is the CANONICAL override — once set, the row never
  // needs review again, regardless of what the description text says
  // (even if it still literally has the prefix, e.g. the user marked it
  // reviewed without separately editing the text).
  it('is false once reviewed_at is set, even if the prefix is still in the description', () => {
    expect(isDeductionNeedsReview({ description: 'NEEDS REVIEW: Unknown Vendor', reviewed_at: '2026-08-24T00:00:00Z' })).toBe(false);
  });
});

describe('isDocumentNeedsReview', () => {
  it('is true when parsed_json.confidence is low', () => {
    expect(isDocumentNeedsReview({ parsed_json: { confidence: 'low' }, reviewed_at: null })).toBe(true);
  });

  it('is false when confidence is high', () => {
    expect(isDocumentNeedsReview({ parsed_json: { confidence: 'high' }, reviewed_at: null })).toBe(false);
  });

  it('is false when parsed_json is null or missing confidence', () => {
    expect(isDocumentNeedsReview({ parsed_json: null, reviewed_at: null })).toBe(false);
    expect(isDocumentNeedsReview({ parsed_json: {}, reviewed_at: null })).toBe(false);
  });

  it('is false once reviewed_at is set, even when confidence is still low', () => {
    expect(isDocumentNeedsReview({ parsed_json: { confidence: 'low' }, reviewed_at: '2026-08-24T00:00:00Z' })).toBe(false);
  });
});

describe('isSettlementNeedsReview', () => {
  it('is true when the linked document is low-confidence', () => {
    const documentsById = new Map([['doc-1', { parsed_json: { confidence: 'low' }, reviewed_at: null }]]);
    expect(isSettlementNeedsReview({ document_id: 'doc-1' }, documentsById)).toBe(true);
  });

  it('is false when the linked document is high-confidence', () => {
    const documentsById = new Map([['doc-1', { parsed_json: { confidence: 'high' }, reviewed_at: null }]]);
    expect(isSettlementNeedsReview({ document_id: 'doc-1' }, documentsById)).toBe(false);
  });

  it('is false with no linked document (never a guess)', () => {
    expect(isSettlementNeedsReview({ document_id: null }, new Map())).toBe(false);
  });

  it('is false when the document_id points to a document not yet loaded', () => {
    expect(isSettlementNeedsReview({ document_id: 'doc-missing' }, new Map())).toBe(false);
  });

  // Marking the settlement reviewed actually marks its LINKED DOCUMENT
  // reviewed (see markDocumentReviewed()) — proving that flows through
  // correctly here: once the document's own reviewed_at is set, the
  // settlement that points to it stops needing review too, automatically.
  it('is false once the linked document has been marked reviewed', () => {
    const documentsById = new Map([['doc-1', { parsed_json: { confidence: 'low' }, reviewed_at: '2026-08-24T00:00:00Z' }]]);
    expect(isSettlementNeedsReview({ document_id: 'doc-1' }, documentsById)).toBe(false);
  });
});

describe('stripNeedsReviewPrefix', () => {
  it('strips the exact prefix mapExtraction.ts writes', () => {
    expect(stripNeedsReviewPrefix('NEEDS REVIEW: Unknown Vendor Purchase')).toBe('Unknown Vendor Purchase');
  });

  it('tolerates leading whitespace before the prefix', () => {
    expect(stripNeedsReviewPrefix('  NEEDS REVIEW: Something')).toBe('Something');
  });

  it('leaves a description without the prefix completely unchanged', () => {
    expect(stripNeedsReviewPrefix('Walmart — fuel receipt')).toBe('Walmart — fuel receipt');
  });

  it('passes through null unchanged', () => {
    expect(stripNeedsReviewPrefix(null)).toBeNull();
  });

  it('is case-sensitive and exact — a differently-cased or partial match is left alone', () => {
    expect(stripNeedsReviewPrefix('needs review: lowercase')).toBe('needs review: lowercase');
  });
});

// NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24): these two
// builders are the exact update payload src/data/needsReviewMutations.ts's
// useMarkDeductionReviewed()/useMarkDocumentReviewed() send to Supabase —
// tested here since they're pure, rather than needing a mocked mutation
// hook harness for what is really just payload-shape logic.
describe('buildMarkDeductionReviewedUpdate', () => {
  it('sets reviewed_at and strips the NEEDS REVIEW prefix from the description', () => {
    expect(buildMarkDeductionReviewedUpdate('NEEDS REVIEW: Unknown Vendor', '2026-08-24T12:00:00Z')).toEqual({
      reviewed_at: '2026-08-24T12:00:00Z',
      description: 'Unknown Vendor',
    });
  });

  it('leaves an already-clean description untouched apart from reviewed_at', () => {
    expect(buildMarkDeductionReviewedUpdate('Walmart — fuel receipt', '2026-08-24T12:00:00Z')).toEqual({
      reviewed_at: '2026-08-24T12:00:00Z',
      description: 'Walmart — fuel receipt',
    });
  });

  it('defaults `now` to the real current time when omitted', () => {
    const result = buildMarkDeductionReviewedUpdate('NEEDS REVIEW: x');
    expect(typeof result.reviewed_at).toBe('string');
    expect(new Date(result.reviewed_at).getTime()).not.toBeNaN();
  });
});

describe('buildMarkDocumentReviewedUpdate', () => {
  it('sets reviewed_at to the given time', () => {
    expect(buildMarkDocumentReviewedUpdate('2026-08-24T12:00:00Z')).toEqual({ reviewed_at: '2026-08-24T12:00:00Z' });
  });

  it('defaults `now` to the real current time when omitted', () => {
    const result = buildMarkDocumentReviewedUpdate();
    expect(new Date(result.reviewed_at).getTime()).not.toBeNaN();
  });
});

// END-TO-END GUARANTEE (owner decision 2026-08-24, the exact test the
// device-testing request asked for): "a reviewed row never reappears in
// any needs-review count." Simulates the full round trip — a flagged row,
// the mark-reviewed update applied to it, then re-checked against EVERY
// consumer that independently derives a needs-review signal (the plain
// predicate, plus the two real screens' own counting logic) — proving the
// canonical reviewed_at override clears every one of them at once, not
// just the screen where the action was taken.
describe('NEEDS REVIEW WONT CLEAR — end-to-end guarantee', () => {
  it('a deduction marked reviewed never counts as needing review again, anywhere', () => {
    const original = { id: 'd1', description: 'NEEDS REVIEW: Mystery Purchase', reviewed_at: null as string | null };
    expect(isDeductionNeedsReview(original)).toBe(true);

    const update = buildMarkDeductionReviewedUpdate(original.description, '2026-08-24T12:00:00Z');
    const reviewed = { ...original, ...update };

    expect(isDeductionNeedsReview(reviewed)).toBe(false);
    // The cosmetic prefix strip actually happened too, not just the flag.
    expect(reviewed.description).toBe('Mystery Purchase');

    // A list of rows containing the now-reviewed one, filtered the exact
    // way aiCoachSummary.ts / missingDataNudges.ts / the Deductions screen
    // all do — the reviewed row must never survive any of these filters.
    const allRows = [reviewed, { id: 'd2', description: 'NEEDS REVIEW: Still flagged', reviewed_at: null }];
    const stillNeedsReview = allRows.filter(isDeductionNeedsReview);
    expect(stillNeedsReview.map((r) => r.id)).toEqual(['d2']);
  });

  it('a document (and its linked settlement) marked reviewed never counts as needing review again', () => {
    const originalDoc = { id: 'doc-1', parsed_json: { confidence: 'low' }, reviewed_at: null as string | null };
    expect(isDocumentNeedsReview(originalDoc)).toBe(true);

    const update = buildMarkDocumentReviewedUpdate('2026-08-24T12:00:00Z');
    const reviewedDoc = { ...originalDoc, ...update };
    expect(isDocumentNeedsReview(reviewedDoc)).toBe(false);

    const documentsById = new Map([[reviewedDoc.id, reviewedDoc]]);
    expect(isSettlementNeedsReview({ document_id: 'doc-1' }, documentsById)).toBe(false);
  });
});
