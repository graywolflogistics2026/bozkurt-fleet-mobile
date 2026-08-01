import { deriveDocumentTitle } from '@/src/data/documentTitle';

describe('deriveDocumentTitle', () => {
  it('uses the extracted vendor when present', () => {
    expect(deriveDocumentTitle({ vendor: 'Walmart' }, 'Store/Amazon Purchase')).toBe('Walmart');
  });

  it('trims whitespace around the vendor', () => {
    expect(deriveDocumentTitle({ vendor: '  Walmart  ' }, 'Store/Amazon Purchase')).toBe('Walmart');
  });

  it('falls back to the docType label when vendor is missing', () => {
    expect(deriveDocumentTitle({}, 'Store/Amazon Purchase')).toBe('Store/Amazon Purchase');
    expect(deriveDocumentTitle(null, 'Store/Amazon Purchase')).toBe('Store/Amazon Purchase');
  });

  it('falls back when vendor is blank or not a string', () => {
    expect(deriveDocumentTitle({ vendor: '   ' }, 'Fallback')).toBe('Fallback');
    expect(deriveDocumentTitle({ vendor: 123 }, 'Fallback')).toBe('Fallback');
  });
});
