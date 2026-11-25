import { PRIME_WEEKS, PRIME_WEEK_ENDINGS, primeWeekExtraction } from './fixtures/primeWeeks2026';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';

// The owner's 17 real Prime weeks (docs/decisions/advance-family-rule-proposal.md,
// "Export results 2026-11-25"). The stored gate result (reading.settlementGate)
// is what the gate decided when each week was saved; the fixture reproduced
// it exactly for all 17 weeks before stage 3a (commit de54128).

const IMPORT_DATE = '2026-11-25';
const gateOf = (w: string) => evaluateSettlementGate(primeWeekExtraction(w), { importDate: IMPORT_DATE })!;

// Saved WITHOUT line rows today (statement.linesNotSaved).
const SAVED_WITHOUT_ROWS = ['2026-07-31', '2026-08-14', '2026-09-11', '2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-11-20'];
// Stage 3a (advance family) lets these save their rows.
const MATCH_AFTER_3A = ['2026-09-11', '2026-10-09', '2026-10-23'];
// Still saved without rows after stage 3a, and why (lineCauses).
const STILL_MISMATCH: Record<string, { stage: string; difference: number | null; causes: unknown[] }> = {
  '2026-07-31': { stage: 'stage 2 (loads from revenue lines)', difference: null, causes: [{ kind: 'loads', difference: 2282.1 }] },
  '2026-09-25': { stage: 'stage 2 (loads from revenue lines)', difference: null, causes: [{ kind: 'loads', difference: 2004.13 }] },
  '2026-10-02': { stage: 'stage 2 (loads from revenue lines)', difference: null, causes: [{ kind: 'loads', difference: 954.83 }] },
  '2026-10-16': { stage: 'stage 2 (loads from revenue lines)', difference: null, causes: [{ kind: 'loads', difference: 2538.28 }] },
  '2026-11-20': { stage: 'stage 2 (loads from revenue lines)', difference: null, causes: [{ kind: 'loads', difference: 2717.54 }] },
  '2026-08-14': {
    stage: 'stage 4 (Linehaul 47.34- sign)',
    difference: 94.68,
    causes: [
      { kind: 'issue', type: 'revenueLinesMismatch', difference: 94.68 },
      { kind: 'loads', difference: 94.68 },
    ],
  },
};

describe('the 17 exported Prime weeks', () => {
  test('17 Prime weeks, 9 saved without line rows', () => {
    expect(PRIME_WEEK_ENDINGS).toHaveLength(17);
    for (const w of PRIME_WEEK_ENDINGS) expect(isPrimeCarrier(primeWeekExtraction(w).settlement!.carrier)).toBe(true);
    expect(PRIME_WEEK_ENDINGS.filter((w) => PRIME_WEEKS[w].saved.linesNotSaved === true)).toEqual(SAVED_WITHOUT_ROWS);
    expect([...MATCH_AFTER_3A, ...Object.keys(STILL_MISMATCH)].sort()).toEqual(SAVED_WITHOUT_ROWS);
  });

  test.each(PRIME_WEEK_ENDINGS)('%s: the statement gate passes', (w) => {
    expect(gateOf(w).status).toBe('pass');
  });

  for (const w of Object.keys(STILL_MISMATCH)) {
    test.todo(`${w}: line details match after ${STILL_MISMATCH[w].stage}`);
  }
});

describe('stage 3a: the gate before (stored) and after', () => {
  test.each(PRIME_WEEK_ENDINGS.filter((w) => !SAVED_WITHOUT_ROWS.includes(w)))('%s: saved with rows before, UNCHANGED after', (w) => {
    expect(PRIME_WEEKS[w].reading.settlementGate).toMatchObject({ status: 'pass', lineDetails: 'match', lineDifference: null });
    const gate = gateOf(w);
    expect(gate).toMatchObject({ status: 'pass', lineDetails: 'match', lineDifference: null });
    expect('lineCauses' in gate).toBe(false);
  });

  test.each(MATCH_AFTER_3A)('%s: mismatch before (advances), match after', (w) => {
    expect(PRIME_WEEKS[w].reading.settlementGate).toMatchObject({ lineDetails: 'mismatch' });
    expect(gateOf(w)).toMatchObject({ status: 'pass', lineDetails: 'match', lineDifference: null });
  });

  test.each(Object.keys(STILL_MISMATCH))('%s: still mismatch; the causes are named', (w) => {
    const expected = STILL_MISMATCH[w];
    expect(PRIME_WEEKS[w].reading.settlementGate).toMatchObject({ lineDetails: 'mismatch' });
    const gate = gateOf(w);
    expect(gate).toMatchObject({ status: 'pass', lineDetails: 'mismatch', lineDifference: expected.difference });
    expect(gate.status !== 'fail' && gate.lineCauses).toEqual(expected.causes);
  });
});
