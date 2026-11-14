// HARD INPUT LIMITS (owner add-on 2026-10-13): over a limit the import is
// refused before anything is read, with a way forward. Kept from the old
// job engine's scale test (the old reader was removed 2026-11-13); the
// settlement reader's read_start uses the same checkImportLimits().
import { checkImportLimits, MAX_IMPORT_FILE_BYTES } from '../../../../supabase/functions/ai-import/jobEngine';

const MB = 1024 * 1024;

describe('import limits', () => {
  it('200 pages, or more than 10 MB, is refused before anything is read, with a way forward', () => {
    expect(checkImportLimits(200, 9 * MB)).toEqual({
      code: 'too_many_pages',
      message:
        'This file has 200 pages; the limit is 150 pages per import. Split it into smaller files (for example the settlement pages on their own) and import each one.',
    });
    expect(checkImportLimits(20, MAX_IMPORT_FILE_BYTES + 1)?.code).toBe('oversized');
  });

  it('a file inside both limits is accepted', () => {
    expect(checkImportLimits(150, MAX_IMPORT_FILE_BYTES)).toBeNull();
  });
});
