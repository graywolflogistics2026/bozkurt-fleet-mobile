import { PRIME_WEEKS, PRIME_WEEK_ENDINGS, primeWeekExtraction } from './fixtures/primeWeeks2026';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';

// The owner's 17 real Prime weeks (docs/decisions/advance-family-rule-proposal.md,
// "Export results 2026-11-25"). The fixture must reproduce what the gate
// decided when each week was saved, before any rule changes.

const IMPORT_DATE = '2026-11-25';
const gateOf = (w: string) => evaluateSettlementGate(primeWeekExtraction(w), { importDate: IMPORT_DATE })!;

// Saved WITHOUT line rows today (statement.linesNotSaved), and the stage that
// should let each one save its rows.
const NEEDS_STAGE: Record<string, string> = {
  '2026-07-31': 'stage 3a + stage 2 (loads)',
  '2026-08-14': 'stage 4 (Linehaul 47.34- sign)',
  '2026-09-11': 'stage 3a (advance family)',
  '2026-09-25': 'stage 3a + stage 2 (loads)',
  '2026-10-02': 'stage 3a + stage 2 (loads)',
  '2026-10-09': 'stage 3a (advance family)',
  '2026-10-16': 'stage 3a + stage 2 (loads)',
  '2026-10-23': 'stage 3a (advance family)',
  '2026-11-20': 'stage 3a + stage 2 (loads)',
};

describe('the 17 exported Prime weeks', () => {
  test('17 Prime weeks, 9 saved without line rows', () => {
    expect(PRIME_WEEK_ENDINGS).toHaveLength(17);
    for (const w of PRIME_WEEK_ENDINGS) expect(isPrimeCarrier(primeWeekExtraction(w).settlement!.carrier)).toBe(true);
    const notSaved = PRIME_WEEK_ENDINGS.filter((w) => PRIME_WEEKS[w].saved.linesNotSaved === true);
    expect(notSaved).toEqual(Object.keys(NEEDS_STAGE).sort());
  });

  test.each(PRIME_WEEK_ENDINGS)('%s: the statement gate passes', (w) => {
    expect(gateOf(w).status).toBe('pass');
  });

  test.each(PRIME_WEEK_ENDINGS.filter((w) => !NEEDS_STAGE[w]))('%s: line details match, as stored', (w) => {
    const gate = gateOf(w);
    expect(gate).toMatchObject({ status: 'pass', lineDetails: 'match', lineDifference: null });
    expect(PRIME_WEEKS[w].reading.settlementGate).toMatchObject({ lineDetails: 'match' });
  });

  for (const w of Object.keys(NEEDS_STAGE)) {
    test.todo(`${w}: line details match after ${NEEDS_STAGE[w]}`);
  }
});

// Fidelity of the fixture: the gate today gives exactly the stored result.
// Replaced week by week as each stage lands (the stage's own test says what
// changed and why).
describe('the fixture reproduces the stored gate result (before any stage)', () => {
  test.each(PRIME_WEEK_ENDINGS)('%s', (w) => {
    const stored = PRIME_WEEKS[w].reading.settlementGate!;
    const gate = gateOf(w);
    expect(gate.status).toBe(stored.status);
    expect(gate).toMatchObject({ lineDetails: stored.lineDetails, lineDifference: stored.lineDifference });
  });
});
