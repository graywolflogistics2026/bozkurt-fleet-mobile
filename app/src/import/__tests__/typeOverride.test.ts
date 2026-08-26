import {
  docTypeToSimpleDocType,
  simpleDocTypeToDocType,
  remapExtractionToSimpleType,
  SIMPLE_DOC_TYPES,
} from '@/src/import/typeOverride';
import { mapPurchase } from '@/src/import/mapExtraction';
import type { Extraction } from '@/src/import/types';

describe('docTypeToSimpleDocType — the selector\'s prefilled starting value', () => {
  it('maps the 5 raw docTypes with a dedicated bucket to that bucket', () => {
    expect(docTypeToSimpleDocType('settlement')).toBe('settlement');
    expect(docTypeToSimpleDocType('fuel')).toBe('fuel');
    expect(docTypeToSimpleDocType('maintenance')).toBe('maintenance');
    expect(docTypeToSimpleDocType('amazon')).toBe('expense_receipt');
    expect(docTypeToSimpleDocType('store')).toBe('expense_receipt');
  });

  it('folds every other raw docType into "other" (no dedicated bucket in the 7-way selector)', () => {
    expect(docTypeToSimpleDocType('w2')).toBe('other');
    expect(docTypeToSimpleDocType('insurance')).toBe('other');
    expect(docTypeToSimpleDocType('loan_agreement')).toBe('other');
    expect(docTypeToSimpleDocType('toll')).toBe('other');
    expect(docTypeToSimpleDocType('other')).toBe('other');
  });
});

describe('simpleDocTypeToDocType', () => {
  it('every one of the 7 options resolves to a real, valid DocType', () => {
    for (const simple of SIMPLE_DOC_TYPES) {
      expect(typeof simpleDocTypeToDocType(simple)).toBe('string');
    }
  });

  it('toll and bank_statement both route to the SAME generic fallback docType as "other" — an honest, documented gap, not a silent one', () => {
    expect(simpleDocTypeToDocType('toll')).toBe('other');
    expect(simpleDocTypeToDocType('bank_statement')).toBe('other');
    expect(simpleDocTypeToDocType('other')).toBe('other');
  });
});

describe('remapExtractionToSimpleType — settlement -> expense receipt (the required test case)', () => {
  const aiClassifiedSettlement: Extraction = {
    docType: 'settlement',
    confidence: 'high',
    settlement: {
      weekEnding: '2026-06-06',
      carrier: 'Prime Inc',
      grossRevenue: 1000,
      netPay: 850,
    },
  };

  it('changing the type to "Expense receipt" produces docType "store" with vendor/date/amount pulled from the settlement fields', () => {
    const remapped = remapExtractionToSimpleType(aiClassifiedSettlement, 'expense_receipt');
    expect(remapped.docType).toBe('store');
    expect(remapped.vendor).toBe('Prime Inc');
    expect(remapped.date).toBe('2026-06-06');
    expect(remapped.totalAmount).toBe(850);
    expect(remapped.purchase).toEqual({}); // truthy, satisfies aiImportSave.ts's own dispatch gate
  });

  it('END TO END: saving the remapped extraction via mapPurchase() produces a deduction with amount, date, and vendor intact', () => {
    const remapped = remapExtractionToSimpleType(aiClassifiedSettlement, 'expense_receipt');
    const rows = mapPurchase(remapped, 'user-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].insert.amount).toBe(850);
    expect(rows[0].insert.ded_date).toBe('2026-06-06');
    expect(rows[0].insert.store).toBe('Prime Inc');
  });

  it('the ORIGINAL settlement sub-object is preserved, not deleted — switching back to "Settlement" loses nothing', () => {
    const remapped = remapExtractionToSimpleType(aiClassifiedSettlement, 'expense_receipt');
    expect(remapped.settlement).toEqual(aiClassifiedSettlement.settlement);
  });
});

describe('remapExtractionToSimpleType — ensures the target sub-object is truthy so it is never silently dropped', () => {
  it('remapping to "fuel" with no prior fuel data synthesizes a truthy fuel object from the best-available amount/vendor', () => {
    const extraction: Extraction = { docType: 'other', totalAmount: 120, vendor: 'Pilot Travel Center' };
    const remapped = remapExtractionToSimpleType(extraction, 'fuel');
    expect(remapped.docType).toBe('fuel');
    expect(remapped.fuel).toEqual({ gross: 120, station: 'Pilot Travel Center' });
  });

  it('remapping to "maintenance" with no prior maintenance data synthesizes a truthy maintenance object', () => {
    const extraction: Extraction = { docType: 'other', totalAmount: 450, vendor: 'Joe\'s Truck Repair', summary: 'Brake job' };
    const remapped = remapExtractionToSimpleType(extraction, 'maintenance');
    expect(remapped.docType).toBe('maintenance');
    expect(remapped.maintenance).toEqual({ total: 450, shop: "Joe's Truck Repair", description: 'Brake job' });
  });

  it('an already-populated sub-object for the target type is never overwritten', () => {
    const extraction: Extraction = {
      docType: 'other',
      fuel: { gross: 999, station: 'Already Correct' },
    };
    const remapped = remapExtractionToSimpleType(extraction, 'fuel');
    expect(remapped.fuel).toEqual({ gross: 999, station: 'Already Correct' });
  });
});

describe('remapExtractionToSimpleType — never overwrites an already-correct top-level field', () => {
  it('a top-level vendor/date/totalAmount that is already set wins over any nested fallback', () => {
    const extraction: Extraction = {
      docType: 'settlement',
      vendor: 'Explicit Vendor',
      date: '2026-01-01',
      totalAmount: 42,
      settlement: { carrier: 'Different Carrier', weekEnding: '2026-06-06', netPay: 999 },
    };
    const remapped = remapExtractionToSimpleType(extraction, 'expense_receipt');
    expect(remapped.vendor).toBe('Explicit Vendor');
    expect(remapped.date).toBe('2026-01-01');
    expect(remapped.totalAmount).toBe(42);
  });
});

describe('remapExtractionToSimpleType — toll / bank_statement / other', () => {
  const extraction: Extraction = { docType: 'settlement', totalAmount: 15, vendor: 'EZPass', date: '2026-06-10' };

  it('all three route to docType "other" with the common fields preserved, no invented sub-object', () => {
    for (const target of ['toll', 'bank_statement', 'other'] as const) {
      const remapped = remapExtractionToSimpleType(extraction, target);
      expect(remapped.docType).toBe('other');
      expect(remapped.totalAmount).toBe(15);
      expect(remapped.vendor).toBe('EZPass');
      expect(remapped.date).toBe('2026-06-10');
    }
  });
});
