import { mapFuel, mapGenericDeduction, mapMaintenance, mapPurchase, mapSettlement } from '@/src/import/mapExtraction';
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

  it('maps ezpass tolls', () => {
    const r = mapSettlement(extraction, 'user-1', 'truck-1');
    expect(r.tolls).toEqual([expect.objectContaining({ network: 'ezpass', amount: 12.5 })]);
  });

  it('falls back to the document date as week_ending when weekEnding is missing', () => {
    const r = mapSettlement({ docType: 'settlement', date: '2026-06-27', settlement: {} }, 'user-1', null);
    expect(r.settlement.week_ending).toBe('2026-06-27');
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

  it('adds a Sales tax & fees line covering the gap to the invoice grand total', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: { items: [{ name: 'Widget', qty: 1, price: 100 }], total: 108.25 },
    };
    const lines = mapPurchase(d, 'user-1');
    expect(lines).toHaveLength(2);
    expect(lines[1].insert.description).toContain('Sales tax & fees');
    expect(lines[1].insert.amount).toBeCloseTo(8.25, 2);
  });

  it('uses the explicit tax field over the total-minus-items gap when present', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: { items: [{ name: 'Widget', qty: 1, price: 100 }], tax: 7.5, total: 107.5 },
    };
    const lines = mapPurchase(d, 'user-1');
    expect(lines[1].insert.amount).toBeCloseTo(7.5, 2);
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
  it('creates one OTHER-coded deduction for unhandled doc types (toll/loan/other)', () => {
    const d: Extraction = { docType: 'toll', date: '2026-06-10', totalAmount: 42, summary: 'Toll bill' };
    expect(mapGenericDeduction(d, 'user-1')).toMatchObject({ code: 'OTHER', amount: 42, description: 'Toll bill', category: 'Other' });
  });
});
