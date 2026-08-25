import { buildComplianceAttachmentPath } from '@/src/compliance/attachment';

describe('buildComplianceAttachmentPath', () => {
  it('builds a user-scoped path under a Compliance folder, slugified by label', () => {
    expect(buildComplianceAttachmentPath('user-1', 'DOT Medical Card', 'card.jpg')).toBe(
      'user-1/Compliance/DOT-Medical-Card/card.jpg'
    );
  });

  it('always starts with the exact user_id (RLS storage-path convention)', () => {
    const path = buildComplianceAttachmentPath('abc-123', 'IRP Registration', 'doc.pdf');
    expect(path.startsWith('abc-123/')).toBe(true);
  });

  it('handles an empty/custom label without throwing', () => {
    expect(buildComplianceAttachmentPath('user-1', '', 'file.pdf')).toBe('user-1/Compliance/file/file.pdf');
  });
});
