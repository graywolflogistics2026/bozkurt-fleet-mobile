import { PRIME_WEEK_ENDINGS, primeWeekExtraction } from './fixtures/primeWeeks2026';
import { buildAdvanceFamily, buildPrimeGroupChecks, MAX_FEE_PER_ADVANCE_LINE } from '@/src/import/primeLineGroups';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { lineDetailsDifference } from '@/src/import/reviewVerdict';
import { checkSettlementReconciliation } from '@/src/import/settlementReconciliation';
import type { Extraction } from '@/src/import/types';

// STAGE 3a — the advance family (owner decisions 2026-11-25,
// docs/decisions/advance-family-rule-proposal.md sections 2-3 and "Export
// results 2026-11-25"), on the owner's 17 real Prime weeks.

type Settlement = NonNullable<Extraction['settlement']>;
const week = (w: string) => primeWeekExtraction(w);
const withSettlement = (e: Extraction, patch: (s: Settlement) => Partial<Settlement>): Extraction => ({ ...e, settlement: { ...e.settlement!, ...patch(e.settlement!) } });
const family = (e: Extraction) => buildAdvanceFamily(e)!;
const familyCheck = (e: Extraction) => buildPrimeGroupChecks(e)!.find((g) => g.group === 'advance_family');

// The owner's independent calculation on the export (fees per class; the
// sum is WIRE CHARGE minus the FC lines, exact). Classes with a line or a
// statement row are listed; a PLAIN fee of 0.00 is where ADVANCE lines tie
// ADVANCES exactly.
const FEES: Record<string, Record<string, number> | null> = {
  '2026-07-31': { lumper: 2, late: 2.55, plain: 0 },
  '2026-08-07': { weight: 2, plain: 0 },
  '2026-08-14': { weight: 4, plain: 0 },
  '2026-08-21': { weight: 1, plain: 0 },
  '2026-08-28': { plain: 0 },
  '2026-09-04': { plain: 0 },
  '2026-09-11': { weight: 3, lumper: 2, fuel: 2, plain: 0 },
  '2026-09-18': { plain: 0 },
  '2026-09-25': { weight: 2, lumper: 3.55 },
  '2026-10-02': { weight: 2, lumper: 1, late: 2.55 },
  '2026-10-09': { weight: 2, lumper: 2.55 },
  '2026-10-16': { weight: 1, lumper: 2, fuel: 2 },
  '2026-10-23': { weight: 1, lumper: 1 },
  '2026-10-30': null, // no WA line: the group does not run
  '2026-11-06': null,
  '2026-11-13': { weight: 3 },
  '2026-11-20': { plain: 2.55 },
};
const PRINCIPAL: Record<string, { uf: number; rf: number }> = {
  '2026-09-11': { uf: 1272.31, rf: 66.85 },
  '2026-10-16': { uf: 986.84, rf: 12.16 },
};

describe('advance family on the 17 exported weeks', () => {
  test('the export has 17 weeks', () => expect(Object.keys(FEES).sort()).toEqual(PRIME_WEEK_ENDINGS));

  test.each(PRIME_WEEK_ENDINGS)('%s: fees as the owner calculated, summing to WIRE CHARGE − FC exactly', (w) => {
    const f = buildAdvanceFamily(week(w));
    if (FEES[w] == null) {
      expect(f).toBeNull();
      expect(familyCheck(week(w))).toBeUndefined();
      return;
    }
    expect(f).toMatchObject({ fees: FEES[w], reasons: [], passed: true, unexplained: 0 });
    expect(f!.feesTotal).toBe(f!.wireFees);
    expect(f!.principal).toEqual(PRINCIPAL[w] ?? { uf: 0, rf: 0 });
    expect(familyCheck(week(w))).toMatchObject({ difference: 0, passed: true, reasons: [] });
  });

  test.each(PRIME_WEEK_ENDINGS)('%s: every Prime group ties (fuel groups include the advance principals)', (w) => {
    expect(buildPrimeGroupChecks(week(w))!.filter((g) => !g.passed)).toEqual([]);
  });

  test.each(PRIME_WEEK_ENDINGS)('%s: deduction lines + uncovered fuel tie TOTAL DEDUCTIONS; no other line-total issue except 08-14', (w) => {
    const issues = checkSettlementReconciliation(week(w)).issues;
    expect(issues.map((i) => i.type)).toEqual(w === '2026-08-14' ? ['revenueLinesMismatch'] : []);
  });

  test('09-11 and 10-16: the fuel groups tie only because the parsed principals are added', () => {
    for (const [w, p] of Object.entries(PRINCIPAL)) {
      const groups = buildPrimeGroupChecks(week(w))!;
      const tractor = groups.find((g) => g.group === 'tractor_fuel')!;
      const reefer = groups.find((g) => g.group === 'reefer_fuel')!;
      expect(tractor).toMatchObject({ difference: 0, passed: true });
      expect(reefer).toMatchObject({ difference: 0, passed: true });
      // Without the principal the fuel lines alone fall short by exactly it.
      expect(Math.round((tractor.statement - (tractor.settlement - p.uf)) * 100) / 100).toBe(p.uf);
      expect(Math.round((reefer.statement - (reefer.settlement - p.rf)) * 100) / 100).toBe(p.rf);
    }
  });
});

describe('named reasons: nothing is absorbed', () => {
  const W = '2026-10-02';
  const addWa = (desc: string, amount: number) => withSettlement(week(W), (s) => ({ deductions: [...(s.deductions ?? []), { code: 'WA', desc, amount }] }));

  test('an unrecognized WA description fails the group and keeps the week unsaved, named', () => {
    const e = addWa('ADV FOR TOLLS', 25);
    expect(family(e).reasons).toContain('advance_unrecognized');
    expect(family(e).unexplained).toBe(25);
    const gate = evaluateSettlementGate(e, { importDate: '2026-11-25' })!;
    expect(gate).toMatchObject({ status: 'pass', lineDetails: 'mismatch' });
    expect(gate.status !== 'fail' && gate.lineCauses).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'group', group: 'advance_family', reasons: expect.arrayContaining(['advance_unrecognized']) })])
    );
  });

  test('D6: "WKLY PYMT OF ADV" stays unrecognized', () => {
    expect(family(addWa('WKLY PYMT OF ADV', 550)).reasons).toContain('advance_unrecognized');
  });

  test.each(['ADV FOR UF- 136.8X', 'ADV FOR UF- 136.84 TRUCKSTOP', 'ADV FOR UF-', 'ADV FOR RF 12.16'])('unparsable fuel text "%s"', (desc) => {
    const f = family(addWa(desc, 137.84));
    expect(f.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^advance_(fuel_unparsable|unrecognized)$/)]));
    expect(f.passed).toBe(false);
  });

  test('"ADV FOR UF- 136.8X" is named advance_fuel_unparsable', () => {
    expect(family(addWa('ADV FOR UF- 136.8X', 137.84)).reasons).toContain('advance_fuel_unparsable');
  });

  test('a late fee without its LE reimbursement: late_fee_not_reimbursed', () => {
    const e = withSettlement(week(W), (s) => ({ reimbursementItems: (s.reimbursementItems ?? []).filter((r) => r.code !== 'LE') }));
    expect(family(e).reasons).toContain('late_fee_not_reimbursed');
    expect(familyCheck(e)!.passed).toBe(false);
  });

  test('one cent off (WIRE CHARGE 6.54 instead of 6.55 in 10-02): fees_differ, no tolerance', () => {
    const e = withSettlement(week(W), (s) => ({
      operating: { ...s.operating!, lines: (s.operating!.lines ?? []).map((l) => (l.label === 'WIRE CHARGE' ? { ...l, amount: -6.54 } : l)) },
    }));
    expect(family(e).reasons).toEqual(['fees_differ']);
    expect(familyCheck(e)).toMatchObject({ difference: 0.01, passed: false });
    expect(lineDetailsDifference({ issues: [], groups: buildPrimeGroupChecks(e) })).toBe(0.01);
  });

  test('a fee above the 2.55-per-line cap: advance_fee_out_of_range:<class>', () => {
    // LUMPERS printed 3.00 lower and WIRE CHARGE 3.00 higher: the sum still
    // ties, but the lumper fee is 4.00 on one line (> 2.55).
    const e = withSettlement(week(W), (s) => ({
      operating: {
        ...s.operating!,
        lines: (s.operating!.lines ?? []).map((l) =>
          l.label === 'LUMPERS' ? { ...l, amount: -198 } : l.label === 'WIRE CHARGE' ? { ...l, amount: -9.55 } : l
        ),
      },
    }));
    expect(MAX_FEE_PER_ADVANCE_LINE).toBe(2.55);
    expect(family(e).fees.lumper).toBe(4);
    expect(family(e).reasons).toEqual(['advance_fee_out_of_range:lumper']);
  });

  test('a negative fee (statement row larger than the lines) is out of range too', () => {
    const e = withSettlement(week(W), (s) => ({
      operating: {
        ...s.operating!,
        lines: (s.operating!.lines ?? []).map((l) => (l.label === 'WEIGHT TICKETS' ? { ...l, amount: -23.5 } : l.label === 'WIRE CHARGE' ? { ...l, amount: -3.55 } : l)),
      },
    }));
    expect(family(e).reasons).toContain('advance_fee_out_of_range:weight');
  });

  test('D2: LM, WT and FC coded lines join LUMPER, WEIGHT and WIRE', () => {
    const e = withSettlement(week(W), (s) => ({
      deductions: [...(s.deductions ?? []), { code: 'LM', desc: 'OUTSIDE LUMPER', amount: 100 }, { code: 'WT', desc: 'WEIGHT TICKETS', amount: 12 }, { code: 'FC', desc: 'FUEL CARD CHARGE', amount: 1 }],
      operating: {
        ...s.operating!,
        lines: (s.operating!.lines ?? []).map((l) =>
          l.label === 'LUMPERS' ? { ...l, amount: -301 } : l.label === 'WEIGHT TICKETS' ? { ...l, amount: -32.5 } : l.label === 'WIRE CHARGE' ? { ...l, amount: -7.55 } : l
        ),
      },
    }));
    expect(family(e)).toMatchObject({ fees: { weight: 2, lumper: 1, late: 2.55 }, passed: true });
  });

  test('a non-Prime carrier is unaffected: no group checks at all', () => {
    const e = withSettlement(week(W), () => ({ carrier: 'OTHER CARRIER LLC' }));
    expect(buildPrimeGroupChecks(e)).toBeNull();
    expect(buildAdvanceFamily(e)).toBeNull();
  });
});
