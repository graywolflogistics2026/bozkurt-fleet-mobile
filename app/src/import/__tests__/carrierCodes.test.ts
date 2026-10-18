import {
  normalizeCarrierKey,
  findCarrierCodeMatch,
  classifySettlementLineForCarrier,
  applyCarrierCodeCategories,
  buildCarrierCodePromptBlock,
  type CarrierCode,
} from '@/src/import/carrierCodes';

describe('normalizeCarrierKey', () => {
  test('uppercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeCarrierKey('Prime, Inc.')).toBe('PRIME INC');
    expect(normalizeCarrierKey('PRIME   INC')).toBe('PRIME INC');
    expect(normalizeCarrierKey('prime inc')).toBe('PRIME INC');
  });

  test('null/empty — null', () => {
    expect(normalizeCarrierKey(null)).toBeNull();
    expect(normalizeCarrierKey(undefined)).toBeNull();
    expect(normalizeCarrierKey('')).toBeNull();
    expect(normalizeCarrierKey('   ')).toBeNull();
  });
});

const PRIME_DH: CarrierCode = {
  carrier: 'PRIME INC',
  code: 'DH',
  subCode: null,
  label: 'DEADHEAD',
  description: 'Extra miles to pickup load',
  category: null,
  isDeductible: null,
  incomeOrChargeback: 'income',
  notes: null,
};
const PRIME_BT: CarrierCode = {
  carrier: 'PRIME INC',
  code: 'BT',
  subCode: null,
  label: 'BTDH INSURANCE',
  description: 'Bobtail/deadhead insurance',
  category: 'Insurance—Truck',
  isDeductible: true,
  incomeOrChargeback: 'chargeback',
  notes: null,
};
// A DIFFERENT carrier deliberately reusing the same 2-letter code "DH" for
// something completely unrelated — proves carrier isolation.
const OTHER_DH: CarrierCode = {
  carrier: 'LANDSTAR',
  code: 'DH',
  subCode: null,
  label: 'DUES HELD',
  description: 'Association dues withheld',
  category: 'Association Dues',
  isDeductible: true,
  incomeOrChargeback: 'chargeback',
  notes: null,
};

const CODES = [PRIME_DH, PRIME_BT, OTHER_DH];

// "the same code under two carriers resolves differently" (spec item 6)
describe('same code resolves differently by carrier', () => {
  test('DH under PRIME INC has no category (income code)', () => {
    const result = findCarrierCodeMatch('PRIME INC', 'DH charge this week', CODES);
    expect(result).toEqual(PRIME_DH);
    expect(classifySettlementLineForCarrier('PRIME INC', 'DH charge this week', CODES)).toBeNull();
  });

  test('the SAME text "DH" under LANDSTAR resolves to Association Dues', () => {
    const result = findCarrierCodeMatch('LANDSTAR', 'DH charge this week', CODES);
    expect(result).toEqual(OTHER_DH);
    expect(classifySettlementLineForCarrier('LANDSTAR', 'DH charge this week', CODES)).toBe('Association Dues');
  });
});

// "an unknown carrier falls back to the generic classifier" (spec item 6)
describe('unknown carrier falls back (returns null, never a guess)', () => {
  test('a carrier with zero seeded codes', () => {
    expect(findCarrierCodeMatch('SCHNEIDER', 'DH charge', CODES)).toBeNull();
    expect(classifySettlementLineForCarrier('SCHNEIDER', 'DH charge', CODES)).toBeNull();
  });

  test('no carrier at all (null)', () => {
    expect(findCarrierCodeMatch(null, 'DH charge', CODES)).toBeNull();
  });

  test('no description at all', () => {
    expect(findCarrierCodeMatch('PRIME INC', null, CODES)).toBeNull();
    expect(findCarrierCodeMatch('PRIME INC', undefined, CODES)).toBeNull();
  });

  test('carrier matches but no code in that carrier\'s own map appears in the text', () => {
    expect(findCarrierCodeMatch('PRIME INC', 'completely unrelated line item text', CODES)).toBeNull();
  });
});

// "Prime codes never leak into a non-Prime import" (spec item 6)
describe('Prime codes never leak into a non-Prime import', () => {
  test('a description containing "BT" (Prime\'s insurance code) never matches under a different carrier', () => {
    expect(findCarrierCodeMatch('LANDSTAR', 'BT charge for insurance', CODES)).toBeNull();
  });

  test('a description containing "DEADHEAD" (Prime\'s DH label) never matches under a different carrier', () => {
    expect(findCarrierCodeMatch('SCHNEIDER', 'DEADHEAD miles this week', CODES)).toBeNull();
  });
});

describe('findCarrierCodeMatch — label fallback', () => {
  test('matches on the spelled-out label when the bare code is not present', () => {
    const result = findCarrierCodeMatch('PRIME INC', 'BTDH INSURANCE charge', CODES);
    expect(result).toEqual(PRIME_BT);
  });

  test('a short code never matches inside an unrelated word (word-boundary guard)', () => {
    // "DH" must not match inside "ADHESIVE" or similar.
    expect(findCarrierCodeMatch('PRIME INC', 'ADHESIVE tape purchase', CODES)).toBeNull();
  });
});

describe('applyCarrierCodeCategories', () => {
  test('overrides category (and deductibility) only on rows with a real carrier-scoped match', () => {
    const rows = [
      { description: 'BT charge', category: null, tax_deductible: false },
      { description: 'DH charge', category: null, tax_deductible: false }, // matches PRIME_DH, but its category is null -> untouched
      { description: 'nothing matches here', category: 'Misc', tax_deductible: true },
    ];
    const result = applyCarrierCodeCategories(rows, 'PRIME INC', CODES);
    expect(result[0]).toEqual({ description: 'BT charge', category: 'Insurance—Truck', tax_deductible: true });
    expect(result[1]).toEqual({ description: 'DH charge', category: null, tax_deductible: false });
    expect(result[2]).toEqual({ description: 'nothing matches here', category: 'Misc', tax_deductible: true });
  });

  test('no carrier — every row returned untouched', () => {
    const rows = [{ description: 'BT charge', category: null, tax_deductible: false }];
    expect(applyCarrierCodeCategories(rows, null, CODES)).toEqual(rows);
  });

  test('no codes seeded at all — every row returned untouched', () => {
    const rows = [{ description: 'BT charge', category: null, tax_deductible: false }];
    expect(applyCarrierCodeCategories(rows, 'PRIME INC', [])).toEqual(rows);
  });
});

describe('buildCarrierCodePromptBlock', () => {
  test('empty codes — empty string', () => {
    expect(buildCarrierCodePromptBlock([])).toBe('');
  });

  test('groups by carrier and names each carrier explicitly with a confirm-first instruction', () => {
    const text = buildCarrierCodePromptBlock(CODES);
    expect(text).toContain('PRIME INC');
    expect(text).toContain('LANDSTAR');
    expect(text).toContain('ONLY if');
    expect(text).toContain('ignore this list entirely');
    expect(text).toContain('DH');
    expect(text).toContain('DEADHEAD');
  });
});

// PRINTED CODE FIELD (owner decision 2026-10-17, Prime only).
describe('findCarrierCodeMatch — printed code field (Prime only)', () => {
  const entry = (carrier: string, code: string, label: string, category: string | null): CarrierCode => ({
    carrier,
    code,
    subCode: null,
    label,
    description: null,
    category,
    isDeductible: category === 'Meals (per diem covered)' || category === 'Advance Repayment' ? false : true,
    incomeOrChargeback: 'chargeback',
    notes: null,
  });
  const CODES = [
    entry('PRIME INC', 'PO', 'POINT OF SALE', 'Meals (per diem covered)'),
    entry('PRIME INC', 'WA', 'ADVANCE', 'Advance Repayment'),
    entry('PRIME INC', 'WT', 'WEIGHT TICKETS', 'Tolls & Scales'),
    entry('PRIME INC', 'UR', 'TRACTOR REPAIR', 'Maintenance & Repairs'),
    entry('LANDSTAR', 'PO', 'PURCHASE ORDER', 'Misc'),
  ];

  test('PO "NORTH STAR GRILL, MO" -> Meals by its printed code', () => {
    expect(findCarrierCodeMatch('PRIME INC', 'NORTH STAR GRILL, MO', CODES, 'PO')?.category).toBe('Meals (per diem covered)');
    expect(findCarrierCodeMatch('PRIME INC', 'NORTH STAR GRILL, MO', CODES)).toBeNull();
  });

  test('a label printed in the description still wins: WA "ADV FOR WEIGHT TICKETS" is a scale expense (golden trap 5)', () => {
    expect(findCarrierCodeMatch('PRIME INC', 'ADV FOR WEIGHT TICKETS', CODES, 'WA')?.code).toBe('WT');
    expect(findCarrierCodeMatch('PRIME INC', 'ADVANCE GLOVES ETC', CODES, 'WA')?.code).toBe('WA');
  });

  test('a printed code that is not in the map falls back to the description', () => {
    expect(findCarrierCodeMatch('PRIME INC', 'Inv 009000-3554243', CODES, 'SH')).toBeNull();
    expect(findCarrierCodeMatch('PRIME INC', 'Inv 009000-3554243', CODES, 'UR')?.category).toBe('Maintenance & Repairs');
  });

  test('carrier gate: another carrier never matches on the printed code field', () => {
    expect(findCarrierCodeMatch('LANDSTAR', 'NORTH STAR GRILL, MO', CODES, 'PO')).toBeNull();
  });

  test('applyCarrierCodeCategories reads the row code', () => {
    const [row] = applyCarrierCodeCategories([{ code: 'PO', description: 'NORTH STAR GRILL, MO', category: 'Misc', tax_deductible: true }], 'PRIME INC', CODES);
    expect(row).toMatchObject({ category: 'Meals (per diem covered)', tax_deductible: false });
  });
});
