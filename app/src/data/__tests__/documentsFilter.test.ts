import {
  filterDocuments,
  distinctDocTypes,
  findLinkedRecords,
  summarizeLinkedRecordCounts,
  primaryDocumentDate,
  isImageFilename,
} from '@/src/data/documentsFilter';
import type {
  DocumentRow,
  Settlement,
  Deduction,
  MaintenanceRecord,
  BankStatement,
  ComplianceItem,
  HouseholdIncome,
  FuelPurchase,
  Load,
  Reimbursement,
} from '@/src/types/db';

function doc(overrides: Partial<DocumentRow>): DocumentRow {
  return {
    id: 'd1',
    user_id: 'u1',
    filename: 'file.pdf',
    doc_type: 'fuel',
    doc_date: '2026-07-10',
    amount: 100,
    storage_path: 'u1/2026-07/fuel/file.pdf',
    parsed_json: null,
    reviewed_at: null,
    imported_at: '2026-07-10T00:00:00Z',
    updated_at: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

describe('primaryDocumentDate', () => {
  it('uses doc_date when set', () => {
    expect(primaryDocumentDate(doc({ doc_date: '2026-01-01', imported_at: '2026-07-01T00:00:00Z' }))).toBe('2026-01-01');
  });
  it('falls back to imported_at when doc_date is null', () => {
    expect(primaryDocumentDate(doc({ doc_date: null, imported_at: '2026-07-01T12:34:56Z' }))).toBe('2026-07-01');
  });
});

describe('filterDocuments', () => {
  const docs = [
    doc({ id: 'a', doc_type: 'fuel', doc_date: '2026-07-01', filename: 'shell.pdf', amount: 200 }),
    doc({ id: 'b', doc_type: 'settlement', doc_date: '2026-07-10', filename: 'sett.pdf', amount: 1500 }),
    doc({ id: 'c', doc_type: 'store', doc_date: '2026-06-01', filename: 'amazon.jpg', amount: 50 }),
  ];

  it('sorts chronologically, most recent first', () => {
    const result = filterDocuments(docs);
    expect(result.map((d) => d.id)).toEqual(['b', 'a', 'c']);
  });

  it('filters by docType', () => {
    const result = filterDocuments(docs, { docType: 'fuel' });
    expect(result.map((d) => d.id)).toEqual(['a']);
  });

  it('filters by date range inclusive', () => {
    const result = filterDocuments(docs, { dateFrom: '2026-07-01', dateTo: '2026-07-10' });
    expect(result.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('filters by search matching filename', () => {
    const result = filterDocuments(docs, { search: 'shell' });
    expect(result.map((d) => d.id)).toEqual(['a']);
  });

  it('filters by search matching amount', () => {
    const result = filterDocuments(docs, { search: '1500' });
    expect(result.map((d) => d.id)).toEqual(['b']);
  });

  it('search is case-insensitive', () => {
    const result = filterDocuments(docs, { search: 'AMAZON' });
    expect(result.map((d) => d.id)).toEqual(['c']);
  });

  it('combines filters', () => {
    const result = filterDocuments(docs, { docType: 'store', search: 'amazon' });
    expect(result.map((d) => d.id)).toEqual(['c']);
  });

  // BETA FEEDBACK ROUND 2: needsReviewOnly toggle.
  it('filters by needsReviewOnly (low-confidence extractions)', () => {
    const withConfidence = [
      doc({ id: 'x', parsed_json: { confidence: 'low' } }),
      doc({ id: 'y', parsed_json: { confidence: 'high' } }),
      doc({ id: 'z', parsed_json: null }),
    ];
    const result = filterDocuments(withConfidence, { needsReviewOnly: true });
    expect(result.map((d) => d.id)).toEqual(['x']);
  });

  it('returns everything with no filter', () => {
    expect(filterDocuments(docs)).toHaveLength(3);
  });
});

describe('isImageFilename', () => {
  it.each(['photo.jpg', 'photo.jpeg', 'PHOTO.PNG', 'scan.webp', 'anim.gif'])('treats %s as an image', (filename) => {
    expect(isImageFilename(filename)).toBe(true);
  });
  it.each(['statement.pdf', 'file', null, undefined])('does not treat %s as an image', (filename) => {
    expect(isImageFilename(filename)).toBe(false);
  });
});

describe('distinctDocTypes', () => {
  it('returns unique, sorted doc types actually present', () => {
    const docs = [doc({ doc_type: 'fuel' }), doc({ doc_type: 'settlement' }), doc({ doc_type: 'fuel' })];
    expect(distinctDocTypes(docs)).toEqual(['fuel', 'settlement']);
  });

  it('excludes null doc_type', () => {
    const docs = [doc({ doc_type: null }), doc({ doc_type: 'fuel' })];
    expect(distinctDocTypes(docs)).toEqual(['fuel']);
  });

  it('returns empty array for no documents', () => {
    expect(distinctDocTypes([])).toEqual([]);
  });
});

describe('findLinkedRecords', () => {
  const documentId = 'doc-1';

  it('finds a linked settlement', () => {
    const settlements: Settlement[] = [
      { id: 's1', user_id: 'u1', truck_id: null, driver_id: null, document_id: documentId, week_ending: '2026-07-05', gross: 0, net: 0, miles: 0, tags: null, created_at: '' } as Settlement,
    ];
    const refs = findLinkedRecords(documentId, { settlements });
    expect(refs).toEqual([{ kind: 'settlement', id: 's1', label: 'Settlement — W/E 2026-07-05' }]);
  });

  it('finds a linked deduction, using description then category fallback', () => {
    const deductions: Deduction[] = [
      { id: 'd1', document_id: documentId, description: null, category: 'Equipment' } as Deduction,
    ];
    const refs = findLinkedRecords(documentId, { deductions });
    expect(refs).toEqual([{ kind: 'deduction', id: 'd1', label: 'Equipment' }]);
  });

  it('finds a linked maintenance record', () => {
    const maintenanceRecords: MaintenanceRecord[] = [
      { id: 'm1', document_id: documentId, description: 'Oil change', service_type: 'oil' } as MaintenanceRecord,
    ];
    const refs = findLinkedRecords(documentId, { maintenanceRecords });
    expect(refs).toEqual([{ kind: 'maintenance', id: 'm1', label: 'Oil change' }]);
  });

  it('finds a linked bank statement', () => {
    const bankStatements: BankStatement[] = [
      { id: 'b1', document_id: documentId, statement_month: 'June 2026' } as BankStatement,
    ];
    const refs = findLinkedRecords(documentId, { bankStatements });
    expect(refs).toEqual([{ kind: 'bank_statement', id: 'b1', label: 'June 2026' }]);
  });

  it('finds a linked compliance item via source_document_id', () => {
    const complianceItems: ComplianceItem[] = [
      { id: 'c1', source_document_id: documentId, label: 'DOT Medical Card' } as ComplianceItem,
    ];
    const refs = findLinkedRecords(documentId, { complianceItems });
    expect(refs).toEqual([{ kind: 'compliance_item', id: 'c1', label: 'DOT Medical Card' }]);
  });

  it('finds a linked household income row', () => {
    const householdIncome: HouseholdIncome[] = [
      { id: 'h1', document_id: documentId, income_type: 'w2_wages' } as HouseholdIncome,
    ];
    const refs = findLinkedRecords(documentId, { householdIncome });
    expect(refs).toEqual([{ kind: 'household_income', id: 'h1', label: 'Household income — w2 wages' }]);
  });

  it('excludes rows linked to a different document', () => {
    const settlements: Settlement[] = [{ id: 's1', document_id: 'other-doc' } as Settlement];
    expect(findLinkedRecords(documentId, { settlements })).toEqual([]);
  });

  it('returns an empty array when nothing is linked', () => {
    expect(findLinkedRecords(documentId, {})).toEqual([]);
  });

  it('combines multiple linked kinds', () => {
    const settlements: Settlement[] = [{ id: 's1', document_id: documentId, week_ending: '2026-07-05' } as Settlement];
    const deductions: Deduction[] = [{ id: 'd1', document_id: documentId, description: 'Parts' } as Deduction];
    const refs = findLinkedRecords(documentId, { settlements, deductions });
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.kind).sort()).toEqual(['deduction', 'settlement']);
  });

  // PAYMENT + DESTINATION SUMMARY (owner decision 2026-08-24, device
  // testing round, item 2) — fuel/loads/reimbursements have no document_id
  // of their own, only settlement_id, so they're only reachable via a
  // two-hop lookup: find the linked SETTLEMENT first, then match these
  // three by settlement_id.
  describe('settlement-derived fuel/loads/reimbursements (two-hop via settlement_id)', () => {
    const settlements: Settlement[] = [
      { id: 's1', document_id: documentId, week_ending: '2026-07-05' } as Settlement,
    ];

    it('finds fuel purchases linked via the settlement (no document_id of their own)', () => {
      const fuelPurchases: FuelPurchase[] = [
        { id: 'f1', settlement_id: 's1', location: 'Pilot', fuel_type: 'tractor', amount: 400 } as FuelPurchase,
      ];
      const refs = findLinkedRecords(documentId, { settlements, fuelPurchases });
      expect(refs).toEqual([
        { kind: 'settlement', id: 's1', label: 'Settlement — W/E 2026-07-05' },
        { kind: 'fuel', id: 'f1', label: 'Fuel — Pilot — $400' },
      ]);
    });

    it('finds loads linked via the settlement', () => {
      const loads: Load[] = [{ id: 'l1', settlement_id: 's1', origin: 'Dallas', destination: 'Houston' } as Load];
      const refs = findLinkedRecords(documentId, { settlements, loads });
      expect(refs).toEqual([
        { kind: 'settlement', id: 's1', label: 'Settlement — W/E 2026-07-05' },
        { kind: 'load', id: 'l1', label: 'Load — Dallas → Houston' },
      ]);
    });

    it('finds reimbursements linked via the settlement', () => {
      const reimbursements: Reimbursement[] = [
        { id: 'r1', settlement_id: 's1', description: 'Warranty credit' } as Reimbursement,
      ];
      const refs = findLinkedRecords(documentId, { settlements, reimbursements });
      expect(refs).toEqual([
        { kind: 'settlement', id: 's1', label: 'Settlement — W/E 2026-07-05' },
        { kind: 'reimbursement', id: 'r1', label: 'Warranty credit' },
      ]);
    });

    it('never matches fuel/loads/reimbursements belonging to a DIFFERENT settlement', () => {
      const fuelPurchases: FuelPurchase[] = [{ id: 'f1', settlement_id: 'other-settlement', fuel_type: 'tractor' } as FuelPurchase];
      const refs = findLinkedRecords(documentId, { settlements, fuelPurchases });
      expect(refs).toEqual([{ kind: 'settlement', id: 's1', label: 'Settlement — W/E 2026-07-05' }]);
    });

    it('never traces fuel/loads/reimbursements when there is no linked settlement at all', () => {
      const fuelPurchases: FuelPurchase[] = [{ id: 'f1', settlement_id: 's1', fuel_type: 'tractor' } as FuelPurchase];
      // No `settlements` source passed at all — nothing to hop through.
      expect(findLinkedRecords(documentId, { fuelPurchases })).toEqual([]);
    });

    it('does NOT double-count a settlement-withheld deduction via settlement_id — it is already captured by document_id', () => {
      // aiImportSave.ts stamps a withheld deduction with BOTH document_id
      // AND settlement_id — this proves it appears exactly once, not twice.
      const deductions: Deduction[] = [
        { id: 'd1', document_id: documentId, settlement_id: 's1', description: 'Fuel advance' } as Deduction,
      ];
      const refs = findLinkedRecords(documentId, { settlements, deductions });
      expect(refs.filter((r) => r.kind === 'deduction')).toHaveLength(1);
    });
  });
});

describe('summarizeLinkedRecordCounts', () => {
  it('collapses refs into per-kind counts', () => {
    const counts = summarizeLinkedRecordCounts([
      { kind: 'fuel', id: 'f1', label: 'a' },
      { kind: 'fuel', id: 'f2', label: 'b' },
      { kind: 'fuel', id: 'f3', label: 'c' },
      { kind: 'deduction', id: 'd1', label: 'd' },
      { kind: 'load', id: 'l1', label: 'e' },
      { kind: 'load', id: 'l2', label: 'f' },
      { kind: 'maintenance', id: 'm1', label: 'g' },
    ]);
    expect(counts).toEqual({ fuel: 3, deduction: 1, load: 2, maintenance: 1 });
  });

  it('returns an empty object for no refs', () => {
    expect(summarizeLinkedRecordCounts([])).toEqual({});
  });
});
