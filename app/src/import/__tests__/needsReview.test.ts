import { isDeductionNeedsReview, isDocumentNeedsReview, isSettlementNeedsReview } from '@/src/import/needsReview';

describe('isDeductionNeedsReview', () => {
  it('is true when the description starts with the NEEDS REVIEW prefix', () => {
    expect(isDeductionNeedsReview({ description: 'NEEDS REVIEW: Unknown Vendor' })).toBe(true);
  });

  it('is false for a normal description', () => {
    expect(isDeductionNeedsReview({ description: 'Walmart — fuel receipt' })).toBe(false);
  });

  it('is false for null/undefined description', () => {
    expect(isDeductionNeedsReview({ description: null })).toBe(false);
    expect(isDeductionNeedsReview({ description: undefined as unknown as string | null })).toBe(false);
  });

  it('tolerates leading whitespace', () => {
    expect(isDeductionNeedsReview({ description: '  NEEDS REVIEW: something' })).toBe(true);
  });
});

describe('isDocumentNeedsReview', () => {
  it('is true when parsed_json.confidence is low', () => {
    expect(isDocumentNeedsReview({ parsed_json: { confidence: 'low' } })).toBe(true);
  });

  it('is false when confidence is high', () => {
    expect(isDocumentNeedsReview({ parsed_json: { confidence: 'high' } })).toBe(false);
  });

  it('is false when parsed_json is null or missing confidence', () => {
    expect(isDocumentNeedsReview({ parsed_json: null })).toBe(false);
    expect(isDocumentNeedsReview({ parsed_json: {} })).toBe(false);
  });
});

describe('isSettlementNeedsReview', () => {
  it('is true when the linked document is low-confidence', () => {
    const documentsById = new Map([['doc-1', { parsed_json: { confidence: 'low' } }]]);
    expect(isSettlementNeedsReview({ document_id: 'doc-1' }, documentsById)).toBe(true);
  });

  it('is false when the linked document is high-confidence', () => {
    const documentsById = new Map([['doc-1', { parsed_json: { confidence: 'high' } }]]);
    expect(isSettlementNeedsReview({ document_id: 'doc-1' }, documentsById)).toBe(false);
  });

  it('is false with no linked document (never a guess)', () => {
    expect(isSettlementNeedsReview({ document_id: null }, new Map())).toBe(false);
  });

  it('is false when the document_id points to a document not yet loaded', () => {
    expect(isSettlementNeedsReview({ document_id: 'doc-missing' }, new Map())).toBe(false);
  });
});
