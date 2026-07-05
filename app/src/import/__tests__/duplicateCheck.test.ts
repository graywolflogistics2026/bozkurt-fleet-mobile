import { checkDuplicateImport, type ExistingDocSummary } from '@/src/import/duplicateCheck';
import type { Extraction } from '@/src/import/types';

const existing: ExistingDocSummary[] = [
  { filename: 'receipt.pdf', doc_date: '2026-06-15', doc_type: 'fuel', amount: 594.29, imported_at: '2026-06-15T00:00:00Z' },
];

describe('checkDuplicateImport', () => {
  it('flags a content match on docType+date+amount within a cent', () => {
    const d: Extraction = { docType: 'fuel', date: '2026-06-15', totalAmount: 594.29 };
    const result = checkDuplicateImport(d, 'different-name.pdf', existing);
    expect(result.byContent).toHaveLength(1);
    expect(result.byFilename).toHaveLength(0);
  });

  it('flags a filename match even if content differs', () => {
    const d: Extraction = { docType: 'maintenance', date: '2026-01-01', totalAmount: 1 };
    const result = checkDuplicateImport(d, 'receipt.pdf', existing);
    expect(result.byFilename).toHaveLength(1);
  });

  it('does not flag when nothing matches', () => {
    const d: Extraction = { docType: 'fuel', date: '2026-07-01', totalAmount: 100 };
    const result = checkDuplicateImport(d, 'new-file.pdf', existing);
    expect(result.byContent).toHaveLength(0);
    expect(result.byFilename).toHaveLength(0);
  });

  it('tolerates sub-cent rounding differences as still a match', () => {
    const d: Extraction = { docType: 'fuel', date: '2026-06-15', totalAmount: 594.2899 };
    const result = checkDuplicateImport(d, 'x.pdf', existing);
    expect(result.byContent).toHaveLength(1);
  });
});
