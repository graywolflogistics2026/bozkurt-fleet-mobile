// ROUND 2, item C (owner 2026-11-13, device 08/21): the card asked "What is
// this line? ED — DEF DISCOUNT". ED is the DEF discount at the pump, a
// bridge row offsetting fuel like UD/RD: class REIMBURSEMENT, never asked.
// The seeded server map has no ED row; it is built in (carrierCodes.ts).
import { BUILTIN_CARRIER_CODES, withBuiltinCarrierCodes, type CarrierCode } from '@/src/import/carrierCodes';
import { classifySettlementLines, previewLineQuestions } from '@/src/import/settlementLineClass';

const row = (code: string, label: string, cls: string | null): CarrierCode => ({
  carrier: 'PRIME INC',
  code,
  subCode: null,
  label,
  description: null,
  category: null,
  isDeductible: null,
  incomeOrChargeback: 'income',
  notes: null,
  economicClass: cls,
  classWhenCharge: null,
});

// The live map as the device has it: UD and RD, no ED.
const SERVER_MAP: CarrierCode[] = [
  row('UD', 'TRAC FUEL DSCNT', 'REIMBURSEMENT'),
  row('RD', 'REEF FUEL DSCNT', 'REIMBURSEMENT'),
  { ...row('UF', 'TRACTOR FUEL', 'EXPENSE_VARIABLE'), category: 'Fuel & DEF', isDeductible: true, incomeOrChargeback: 'chargeback' },
];

// 08/21's fuel discount lines as printed (credits).
const LINES_0821 = [
  { code: 'UF', desc: 'TRACTOR FUEL', amount: 1084.52 },
  { code: 'UD', desc: 'TRAC FUEL DSCNT', amount: -152.31 },
  { code: 'ED', desc: 'DEF DISCOUNT', amount: -29.15 },
];

test('without the built-in, ED is asked (the device symptom)', () => {
  const q = previewLineQuestions(LINES_0821, 'PRIME INC', SERVER_MAP, [], null);
  expect(q.some((x) => x.kind === 'unknown_code' && x.code === 'ED')).toBe(true);
});

test('08/21: no ED question; ED is REIMBURSEMENT like UD', () => {
  const codes = withBuiltinCarrierCodes(SERVER_MAP);
  expect(previewLineQuestions(LINES_0821, 'PRIME INC', codes, [], null)).toEqual([]);
  const rows = LINES_0821.map((l) => ({ code: l.code, description: l.desc, amount: l.amount, category: null }));
  const { rows: out } = classifySettlementLines(rows, 'PRIME INC', codes, [], null);
  expect(out.find((r) => r.code === 'ED')!.economic_class).toBe('REIMBURSEMENT');
  expect(out.find((r) => r.code === 'UD')!.economic_class).toBe('REIMBURSEMENT');
});

test('a server row for ED wins over the built-in; no map, nothing added (carrier isolation)', () => {
  const server = [...SERVER_MAP, row('ED', 'DEF DISCOUNT', 'EXPENSE_VARIABLE')];
  expect(withBuiltinCarrierCodes(server)).toBe(server);
  expect(withBuiltinCarrierCodes([])).toEqual([]);
  const other = [{ ...row('XX', 'X', null), carrier: 'OTHER CARRIER' }];
  expect(withBuiltinCarrierCodes(other)).toBe(other);
  expect(BUILTIN_CARRIER_CODES.map((c) => `${c.carrier}:${c.code}:${c.economicClass}`)).toEqual(['PRIME INC:ED:REIMBURSEMENT']);
});
