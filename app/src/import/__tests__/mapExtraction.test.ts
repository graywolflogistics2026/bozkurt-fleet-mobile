import {
  mapCompliance,
  mapDriverPayment,
  mapFinancialDocDeduction,
  mapFuel,
  mapGenericDeduction,
  mapMaintenance,
  mapPurchase,
  mapSettlement,
} from '@/src/import/mapExtraction';
import type { Extraction } from '@/src/import/types';

describe('mapSettlement', () => {
  const extraction: Extraction = {
    docType: 'settlement',
    date: '2026-06-27',
    settlement: {
      weekEnding: '2026-06-27',
      grossRevenue: 5000,
      netPay: 3200,
      totalMiles: 2500,
      loads: [{ order: 'ORD1', from: 'Dallas', to: 'Houston', loadedMiles: 240, revenue: 800 }],
      tractorFuel: [{ date: '2026-06-24', location: 'Pilot', gallons: 100, amount: 380, state: 'TX' }],
      reeferFuel: [{ date: '2026-06-25', location: 'TA', gallons: 20, amount: 80 }],
      deductions: [{ code: 'ELD', desc: 'Motive ELD', amount: 45 }],
      maintenance: [{ invoice: 'INV1', desc: 'Oil change', odometer: 300000, total: 250 }],
      tolls: { ezpass: { items: [{ date: '2026-06-26', amount: 12.5 }] } },
      reimbursementItems: [{ desc: 'Detention pay', ref: 'DET1', amount: 75 }],
    },
  };

  it('maps the settlement row itself', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.settlement).toMatchObject({
      user_id: 'user-1',
      truck_id: 'truck-1',
      week_ending: '2026-06-27',
      gross: 5000,
      net: 3200,
      miles: 2500,
    });
    expect(r.netPay).toBe(3200);
  });

  it('maps loads', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.loads).toEqual([
      expect.objectContaining({ order_number: 'ORD1', origin: 'Dallas', destination: 'Houston', loaded_miles: 240, revenue: 800 }),
    ]);
  });

  it('maps tractor and reefer fuel with the truck tagged and state carried through', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.fuel).toHaveLength(2);
    expect(r.fuel[0]).toMatchObject({ fuel_type: 'tractor', truck_id: 'truck-1', state: 'TX', amount: 380 });
    expect(r.fuel[1]).toMatchObject({ fuel_type: 'reefer', truck_id: 'truck-1', amount: 80 });
  });

  it('tags withheld deductions source=settlement, payment_method=Settlement Withheld (CLAUDE.md invariant #1)', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.deductions).toEqual([
      expect.objectContaining({ source: 'settlement', payment_method: 'Settlement Withheld', amount: 45, code: 'ELD' }),
    ]);
  });

  it('maps maintenance with the truck tagged and normalizes service_type', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.maintenance).toEqual([
      expect.objectContaining({ truck_id: 'truck-1', service_type: 'oil', odometer: 300000, cost: 250 }),
    ]);
  });

  it('maps reimbursementItems into reimbursement rows (legacy/index.html:2516 — previously not ported)', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.reimbursements).toEqual([
      expect.objectContaining({ description: 'Detention pay', reference: 'DET1', amount: 75 }),
    ]);
  });

  it('maps ezpass tolls', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.tolls).toEqual([expect.objectContaining({ network: 'ezpass', amount: 12.5 })]);
  });

  it('falls back to the document date as week_ending when weekEnding is missing', () => {
    const r = mapSettlement({ docType: 'settlement', date: '2026-06-27', settlement: {} }, 'user-1', null);
    expect(r.settlement.week_ending).toBe('2026-06-27');
  });

  it('maps chargebackType to a canonical display category (industry knowledge base, owner decision 2026-07-10)', () => {
    const d: Extraction = {
      docType: 'settlement',
      date: '2026-06-27',
      settlement: {
        weekEnding: '2026-06-27',
        deductions: [{ code: 'PLATE', desc: 'Plate payback', amount: 40, chargebackType: 'plates_permits' }],
      },
    };
    const r = mapSettlement(d, 'user-1', 'truck-1');
    expect(r.deductions[0].category).toBe('Permits, Licenses & Road Taxes');
  });

  it('falls back to the loose category string when chargebackType is absent', () => {
    const d: Extraction = {
      docType: 'settlement',
      date: '2026-06-27',
      settlement: { weekEnding: '2026-06-27', deductions: [{ code: 'X', desc: 'Old-style line', amount: 10, category: 'Fixed' }] },
    };
    const r = mapSettlement(d, 'user-1', 'truck-1');
    expect(r.deductions[0].category).toBe('Fixed');
  });
});

describe('mapFuel', () => {
  it('maps a standalone tractor fuel receipt', () => {
    const d: Extraction = { docType: 'fuel', date: '2026-06-15', fuel: { type: 'tractor', station: 'Pilot', gallons: 100, gross: 380, discount: 5, state: 'OK' } };
    expect(mapFuel(d, 'user-1', 'truck-1')).toMatchObject({
      truck_id: 'truck-1',
      fuel_type: 'tractor',
      location: 'Pilot',
      amount: 380,
      discount: 5,
      state: 'OK',
    });
  });

  it('defaults to tractor when type is missing/reefer is not specified', () => {
    const d: Extraction = { docType: 'fuel', date: '2026-06-15', fuel: {} };
    expect(mapFuel(d, 'user-1', null).fuel_type).toBe('tractor');
  });

  it('maps reefer explicitly', () => {
    const d: Extraction = { docType: 'fuel', date: '2026-06-15', fuel: { type: 'reefer' } };
    expect(mapFuel(d, 'user-1', null).fuel_type).toBe('reefer');
  });
});

describe('mapMaintenance', () => {
  it('maps a standalone maintenance invoice', () => {
    const d: Extraction = {
      docType: 'maintenance',
      date: '2026-05-19',
      maintenance: { invoice: 'INV42', shop: 'Rush Truck Center', description: 'Coolant extender service', odometer: 310000, total: 600 },
    };
    const r = mapMaintenance(d, 'user-1', 'truck-1');
    expect(r.maintenance).toMatchObject({
      truck_id: 'truck-1',
      vendor: 'Rush Truck Center',
      invoice_number: 'INV42',
      odometer: 310000,
      cost: 600,
      service_type: 'coolant_ext', // detectMaintType -> 'coolext' -> normalized
    });
    expect(r.reimbursement).toBeNull();
  });

  it('creates a warranty reimbursement when warrantyCredit > 0', () => {
    const d: Extraction = { docType: 'maintenance', date: '2026-05-19', maintenance: { description: 'Brake repair', warrantyCredit: 150 } };
    const r = mapMaintenance(d, 'user-1', null);
    expect(r.reimbursement).toMatchObject({ amount: 150, description: 'Warranty — Brake repair' });
  });
});

describe('mapPurchase', () => {
  it('books qty × unit price per item', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: { items: [{ name: 'Milwaukee M18 Impact Wrench', qty: 2, price: 159.99 }], total: 319.98 },
    };
    const [line] = mapPurchase(d, 'user-1');
    expect(line.insert.amount).toBeCloseTo(319.98, 2);
    expect(line.insert.description).toContain('2× ');
    expect(line.isPersonalPayment).toBe(false);
  });

  it('folds the gap to the invoice grand total into the single item instead of a separate tax row (CLAUDE.md invariant #3)', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: { items: [{ name: 'Widget', qty: 1, price: 100 }], total: 108.25 },
    };
    const lines = mapPurchase(d, 'user-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].insert.amount).toBeCloseTo(108.25, 2);
    expect(lines[0].insert.description).toContain('(incl. $8.25 tax/fees/services)');
  });

  it('uses the explicit tax field over the total-minus-items gap when present', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: { items: [{ name: 'Widget', qty: 1, price: 100 }], tax: 7.5, total: 107.5 },
    };
    const lines = mapPurchase(d, 'user-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].insert.amount).toBeCloseTo(107.5, 2);
    expect(lines[0].insert.description).toContain('(incl. $7.50 tax/fees/services)');
  });

  it('distributes tax proportionally across multiple items, remainder cent to the largest', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: {
        items: [
          { name: 'Drill', qty: 1, price: 100 },
          { name: 'Bit Set', qty: 1, price: 50 },
        ],
        total: 162.03, // +12.03 to fold in: 2/3 -> Drill, 1/3 -> Bit Set
      },
    };
    const lines = mapPurchase(d, 'user-1');
    expect(lines).toHaveLength(2);
    const total = lines.reduce((s, l) => s + l.insert.amount, 0);
    expect(total).toBeCloseTo(162.03, 2);
    expect(lines[0].insert.amount).toBeCloseTo(108.02, 2); // Drill: 100 + 2/3 of 12.03
    expect(lines[1].insert.amount).toBeCloseTo(54.01, 2); // Bit Set: 50 + 1/3 of 12.03
  });

  it('folds a named-parent service line directly into that item, not the proportional pool', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Walmart',
      purchase: {
        items: [
          { name: 'Milwaukee M18 Drill', qty: 1, price: 150 },
          { name: 'Extended warranty (for Milwaukee M18 Drill)', qty: 1, price: 20 },
        ],
        total: 170,
      },
    };
    const lines = mapPurchase(d, 'user-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].insert.amount).toBeCloseTo(170, 2);
    expect(lines[0].insert.description).toContain('(incl. $20.00 tax/fees/services)');
  });

  it('keeps a receipt with ONLY service/fee lines as NEEDS REVIEW rows', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Best Buy',
      purchase: { items: [{ name: 'Add-on services', qty: 1, price: 15 }], total: 15 },
    };
    const lines = mapPurchase(d, 'user-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].insert.description).toContain('NEEDS REVIEW: Add-on services');
  });

  it('persists warrantyYears onto the item deduction', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: { items: [{ name: 'Generator', qty: 1, price: 500, warrantyYears: 2.5 }], total: 500 },
    };
    const [line] = mapPurchase(d, 'user-1');
    expect(line.insert.warranty_years).toBe(2.5);
  });

  it('flags personal-payment lines for Capital Account linking (CLAUDE.md invariant #2)', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'John Smith',
      purchase: { items: [{ name: 'Private party purchase', qty: 1, price: 50 }], paymentMethod: 'Zelle Personal', total: 50 },
    };
    const [line] = mapPurchase(d, 'user-1');
    expect(line.isPersonalPayment).toBe(true);
    expect(line.insert.description).toContain('Owner Contribution');
  });

  it('does not create a tax line when the total matches the item sum exactly', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Store',
      purchase: { items: [{ name: 'Widget', qty: 1, price: 100 }], total: 100 },
    };
    expect(mapPurchase(d, 'user-1')).toHaveLength(1);
  });
});

describe('mapGenericDeduction', () => {
  it('creates one OTHER-coded deduction for unhandled doc types (toll/loan)', () => {
    const d: Extraction = { docType: 'toll', date: '2026-06-10', totalAmount: 42, summary: 'Toll bill' };
    expect(mapGenericDeduction(d, 'user-1')).toMatchObject({ code: 'OTHER', amount: 42, description: 'Toll bill', category: 'Other' });
  });

  it('extends NEEDS REVIEW to the whole document for docType "other" (universal AI capture, owner decision 2026-07-10)', () => {
    const d: Extraction = {
      docType: 'other',
      date: '2026-06-10',
      totalAmount: 60,
      summary: 'Unclear charge',
      confidence: 'low',
      suggestedCategory: 'Possibly a bank fee',
    };
    expect(mapGenericDeduction(d, 'user-1')).toMatchObject({
      description: 'NEEDS REVIEW: Unclear charge',
      category: 'Possibly a bank fee',
      amount: 60,
    });
  });

  it('falls back to category "Other" for docType "other" when no suggestedCategory is given', () => {
    const d: Extraction = { docType: 'other', date: '2026-06-10', totalAmount: 10, summary: 'Mystery' };
    expect(mapGenericDeduction(d, 'user-1')).toMatchObject({ description: 'NEEDS REVIEW: Mystery', category: 'Other' });
  });
});

describe('mapDriverPayment (universal AI capture, owner decision 2026-07-10)', () => {
  it('maps to a driver_payments row, not a deduction', () => {
    const d: Extraction = {
      docType: 'driver_payment',
      date: '2026-06-10',
      driverPayment: { driverName: 'Jane Doe', amount: 500, method: 'Zelle', notes: 'Week of 6/10' },
    };
    expect(mapDriverPayment(d, 'user-1', 'driver-1')).toMatchObject({
      user_id: 'user-1',
      driver_id: 'driver-1',
      settlement_id: null,
      date: '2026-06-10',
      gross_pay: 500,
      notes: 'Week of 6/10',
    });
  });

  it('falls back to the method when notes is missing', () => {
    const d: Extraction = { docType: 'driver_payment', date: '2026-06-10', driverPayment: { amount: 200, method: 'Cash' } };
    expect(mapDriverPayment(d, 'user-1', 'driver-1').notes).toBe('Cash');
  });

  it('falls back to totalAmount when driverPayment.amount is missing', () => {
    const d: Extraction = { docType: 'driver_payment', date: '2026-06-10', totalAmount: 300, driverPayment: {} };
    expect(mapDriverPayment(d, 'user-1', 'driver-1').gross_pay).toBe(300);
  });
});

describe('mapFinancialDocDeduction (universal AI capture, owner decision 2026-07-10)', () => {
  it('maps insurance to the Insurance—Truck category (renamed 2026-07-10, industry knowledge base)', () => {
    const d: Extraction = {
      docType: 'insurance',
      date: '2026-06-10',
      vendor: 'Progressive Commercial',
      financialDoc: { kind: 'insurance', description: 'Liability policy', amount: 450, reference: 'POL-9981' },
    };
    expect(mapFinancialDocDeduction(d, 'user-1')).toMatchObject({
      category: 'Insurance—Truck',
      amount: 450,
      description: 'Liability policy (POL-9981)',
      store: 'Progressive Commercial',
    });
  });

  it('maps lease_rent to the Lease & Rent category', () => {
    const d: Extraction = {
      docType: 'lease_rent',
      date: '2026-06-10',
      financialDoc: { kind: 'lease_rent', description: 'Trailer lease — Unit 4471', amount: 800 },
    };
    expect(mapFinancialDocDeduction(d, 'user-1')).toMatchObject({ category: 'Lease & Rent', amount: 800 });
  });

  it('maps factoring_statement to the Dispatch & Factoring Fees category (renamed 2026-07-10)', () => {
    const d: Extraction = {
      docType: 'factoring_statement',
      date: '2026-06-10',
      financialDoc: { kind: 'factoring_statement', description: 'Factoring fee', amount: 120, reference: 'INV-1,INV-2' },
    };
    expect(mapFinancialDocDeduction(d, 'user-1')).toMatchObject({ category: 'Dispatch & Factoring Fees', amount: 120 });
  });

  it('maps utility_subscription to the Utilities & Subscriptions category, with period appended', () => {
    const d: Extraction = {
      docType: 'utility_subscription',
      date: '2026-06-10',
      financialDoc: { kind: 'utility_subscription', description: 'Phone bill', amount: 90, period: 'March 2026' },
    };
    const row = mapFinancialDocDeduction(d, 'user-1');
    expect(row.category).toBe('Utilities & Subscriptions');
    expect(row.description).toContain('March 2026');
  });

  it('falls back to vendor/summary when description is missing', () => {
    const d: Extraction = {
      docType: 'insurance',
      date: '2026-06-10',
      vendor: 'Acme Insurance',
      financialDoc: { kind: 'insurance', amount: 200 },
    };
    expect(mapFinancialDocDeduction(d, 'user-1').description).toContain('Acme Insurance');
  });
});

describe('mapCompliance (AI feature package, owner decision 2026-07-10 — compliance tracker)', () => {
  it('maps medical_card to type "medical_card" with a default label', () => {
    const d: Extraction = {
      docType: 'medical_card',
      date: '2026-06-10',
      compliance: { type: 'medical_card', dueDate: '2027-06-10' },
    };
    expect(mapCompliance(d, 'user-1')).toMatchObject({
      user_id: 'user-1',
      type: 'medical_card',
      label: 'DOT Medical Card',
      due_date: '2027-06-10',
    });
  });

  it('maps each compliance docType to its own compliance_items type', () => {
    const cases: Array<[Extraction['docType'], string]> = [
      ['inspection_report', 'annual_inspection'],
      ['registration_cab_card', 'irp_registration'],
      ['irs_2290_schedule1', 'hvut_2290'],
      ['insurance_policy', 'insurance_policy'],
    ];
    for (const [docType, expectedType] of cases) {
      const d: Extraction = { docType, date: '2026-06-10', compliance: { dueDate: '2027-01-01' } };
      expect(mapCompliance(d, 'user-1')?.type).toBe(expectedType);
    }
  });

  it('uses the AI-provided label when present, over the default', () => {
    const d: Extraction = {
      docType: 'insurance_policy',
      date: '2026-06-10',
      compliance: { label: 'Cargo Insurance', dueDate: '2027-01-01' },
    };
    expect(mapCompliance(d, 'user-1')?.label).toBe('Cargo Insurance');
  });

  it('falls back to the document date when compliance.dueDate is missing but a date is present', () => {
    const d: Extraction = { docType: 'medical_card', date: '2026-06-10', compliance: {} };
    expect(mapCompliance(d, 'user-1')?.due_date).toBe('2026-06-10');
  });

  it('never guesses a due date — returns null when neither dueDate nor date is present', () => {
    const d: Extraction = { docType: 'medical_card', compliance: {} };
    expect(mapCompliance(d, 'user-1')).toBeNull();
  });

  it('leaves source_document_id null — filled in by the caller once the documents row exists', () => {
    const d: Extraction = { docType: 'medical_card', date: '2026-06-10', compliance: { dueDate: '2027-06-10' } };
    expect(mapCompliance(d, 'user-1')?.source_document_id).toBeNull();
  });
});
