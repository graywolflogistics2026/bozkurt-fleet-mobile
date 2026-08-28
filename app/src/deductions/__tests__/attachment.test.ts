import { buildDeductionAttachmentPath } from '@/src/deductions/attachment';

describe('buildDeductionAttachmentPath', () => {
  it('builds a user-scoped path under a Receipts folder, slugified by description', () => {
    expect(buildDeductionAttachmentPath('user-1', 'Walmart Store Purchase', 'receipt.jpg')).toBe(
      'user-1/Receipts/Walmart-Store-Purchase/receipt.jpg'
    );
  });

  it('always starts with the exact user_id (RLS storage-path convention)', () => {
    const path = buildDeductionAttachmentPath('abc-123', 'Fuel stop', 'doc.pdf');
    expect(path.startsWith('abc-123/')).toBe(true);
  });

  it('handles an empty description without throwing, falling back to "receipt"', () => {
    expect(buildDeductionAttachmentPath('user-1', '', 'file.pdf')).toBe('user-1/Receipts/receipt/file.pdf');
  });
});
