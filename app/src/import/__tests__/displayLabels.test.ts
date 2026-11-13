// ROUND 2, item I (owner 2026-11-13, device): (a) labels copied exactly
// ("TRIP PRESS CHG" came back for "TRIP XPRESS CHG"); (b) a check whose
// printed and read figures differ, even by 0.07, shows a warning, never a
// check mark; (c) the performance bond shows the same sign on both sides.
import { canonicalStatementLabel, classifyStatementLine } from '@/src/import/primeStatementLines';
import { checkMark } from '@/src/import/checkMark';
import { buildPrimeGroupChecks } from '@/src/import/primeLineGroups';
import { CONTENT_PROMPT } from '@/src/settlementReader/prompt';
import type { Extraction } from '@/src/import/types';

describe('(a) labels', () => {
  test('the prompt says to copy every label letter for letter, naming TRIP XPRESS CHG', () => {
    expect(CONTENT_PROMPT).toMatch(/letter for letter/);
    expect(CONTENT_PROMPT).toContain('"TRIP XPRESS CHG" stays "TRIP XPRESS CHG"');
  });
  test('a dropped letter still lands on the known label (one canonical matcher)', () => {
    expect(canonicalStatementLabel('TRIP PRESS CHG')).toBe('TRIP XPRESS CHG');
    expect(classifyStatementLine({ section: 'misc', label: 'TRIP PRESS CHG' })).toEqual(classifyStatementLine({ section: 'misc', label: 'TRIP XPRESS CHG' }));
  });
});

describe('(b) check marks', () => {
  test('passed with a 0.07 difference: warning, not a check mark', () => {
    expect(checkMark(true, -99.93, -100)).toEqual({ mark: '⚠', tone: 'warn' });
  });
  test('identical: check mark; failed: cross', () => {
    expect(checkMark(true, -100, -100)).toEqual({ mark: '✓', tone: 'ok' });
    expect(checkMark(false, 425.47, 1230.97)).toEqual({ mark: '✗', tone: 'fail' });
  });
});

describe('(c) performance bond signs', () => {
  const week = (statementAmount: number): Extraction => ({
    docType: 'settlement',
    settlement: {
      carrier: 'PRIME INC.',
      deductions: [{ code: 'PB', desc: 'PERFORMANCE BOND', amount: 100 }],
      operating: { lines: [{ section: 'other', label: 'ACCRUAL PERFORMANCE BOND', amount: statementAmount }] },
    },
  });
  test.each([-100, 100])('statement row %p: both sides 100.00, same sign, passed', (amount) => {
    const bond = buildPrimeGroupChecks(week(amount))!.find((g) => g.group === 'performance_bond')!;
    expect(bond).toEqual({ group: 'performance_bond', settlement: 100, statement: 100, difference: 0, passed: true });
  });
  test('a different amount still shows the difference (11/13: 50 withheld)', () => {
    const e = week(-50);
    const bond = buildPrimeGroupChecks(e)!.find((g) => g.group === 'performance_bond')!;
    expect([bond.settlement, bond.statement, bond.passed]).toEqual([100, 50, false]);
  });
});
