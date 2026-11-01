import * as fs from 'fs';
import * as path from 'path';

// ONE SANITIZER FOR EVERY READ PATH (owner decision 2026-10-30, before
// batch D): the background job path (src/data/importJobs.ts) used to run
// only dates + miles and skip the Prime statement check that the live path
// (src/data/aiImportCall.ts) ran. Both now call sanitizeExtraction(); no
// file may compose the guards by hand again.
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');

describe('sanitizeExtraction is the only composition of the read guards', () => {
  it.each(['src/data/aiImportCall.ts', 'src/data/importJobs.ts'])('%s uses sanitizeExtraction() and never composes the guards itself', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/import \{ sanitizeExtraction \} from '@\/src\/import\/sanitizeExtraction'/);
    expect(src).not.toMatch(/sanitizeExtractionMiles\(|sanitizeExtractionDates\(|applyPrimeOperatingStatementCheck\(/);
  });

  it('saveExtraction() runs the same save gate the preview renders', () => {
    const src = read('src/data/aiImportSave.ts');
    expect(src).toMatch(/const gate = evaluateSettlementGate\(d, /);
    expect(src).not.toMatch(/reconciliationOverride\.length/);
  });
});
