// Device 11/06 (owner 2026-11-13): a failed recap check showed "Check
// failed: SUBTOTAL PRIOR WAGE D". The failure names the real identity.
import en from '@/src/i18n/locales/en.json';
import { gateFailureLines } from '@/src/import/gateFailureText';

const get = (key: string): string => key.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), en);
const t = (key: string, opts: Record<string, unknown> = {}) => {
  const raw = get(key);
  const s = typeof raw === 'string' ? raw : String(opts.defaultValue ?? key);
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};

test('the recap check names "Recap deductions do not match truck deductions + wages", once, never SUBTOTAL PRIOR WAGE D', () => {
  const lines = gateFailureLines(
    { reason: 'net_due_differs', failures: ['wageIdentityMismatch'], details: [{ check: 'deductionsFromSettlements', printed: 9232.02, read: 9232.01 + 2 }] },
    t
  );
  expect(lines).toEqual(['Recap deductions do not match truck deductions + wages (TOTAL DEDUCTIONS FROM SETTLEMENTS): printed 9232.02, read 9234.01']);
  expect(lines.join(' ')).not.toContain('SUBTOTAL PRIOR WAGE D');
});

test('the wage subtotal check names its own identity', () => {
  const lines = gateFailureLines({ reason: 'net_due_differs', failures: ['wageIdentityMismatch'], details: [{ check: 'subtotalPriorWage', printed: 1330.97, read: 1230.97 }] }, t);
  expect(lines).toEqual(['Wage subtotal does not match revenue + reimbursed − truck deductions (SUBTOTAL PRIOR WAGE D): printed 1330.97, read 1230.97']);
});
