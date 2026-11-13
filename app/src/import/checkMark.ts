// The mark next to a printed-vs-read check (round 2 item I(b), owner
// 2026-11-13): a check that passed within its tolerance but whose two
// figures still differ by a cent or more shows a warning, never a check
// mark ("Other income and expense lines: printed -99.93, read -100.00"
// showed a check mark). Pure.
export type CheckTone = 'ok' | 'warn' | 'fail';

export function checkMark(passed: boolean, a: number, b: number): { mark: string; tone: CheckTone } {
  if (!passed) return { mark: '✗', tone: 'fail' };
  if (Math.abs(Math.round((a - b) * 100)) >= 1) return { mark: '⚠', tone: 'warn' };
  return { mark: '✓', tone: 'ok' };
}
