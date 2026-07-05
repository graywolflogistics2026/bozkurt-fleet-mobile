import { detectMaintType, getCatNote, guessCategory, isPersonalPayment, toDbServiceType } from '@/src/import/category';
import type {
  DeductionInsert,
  FuelPurchaseInsert,
  LoadInsert,
  LoanInsert,
  MaintenanceRecordInsert,
  ReimbursementInsert,
  SettlementInsert,
  TollInsert,
} from '@/src/types/db';
import type { Extraction, ExtractedFuel, ExtractedToll } from '@/src/import/types';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}

// ---------- settlement (legacy saveImport() settlement branch, legacy/index.html:2510-2527) ----------
// Returns rows WITHOUT settlement_id/document_id set — the caller (impure
// orchestration layer) fills those in once the parent settlement/document
// rows actually exist in Postgres and have real ids.
export type SettlementMapping = {
  settlement: SettlementInsert;
  loads: LoadInsert[];
  fuel: FuelPurchaseInsert[];
  deductions: DeductionInsert[];
  maintenance: MaintenanceRecordInsert[];
  tolls: TollInsert[];
  loans: LoanInsert[];
  netPay: number;
};

function toFuelInsert(f: ExtractedFuel, fuelType: 'tractor' | 'reefer', userId: string, truckId: string | null, fallbackDate?: string): FuelPurchaseInsert {
  return {
    user_id: userId,
    truck_id: truckId,
    settlement_id: null,
    fuel_type: fuelType,
    purchase_date: f.date ?? fallbackDate ?? null,
    location: f.location ?? null,
    state: f.state ?? null,
    gallons: f.gallons ?? null,
    amount: f.amount ?? null,
    discount: num(f.discount),
  };
}

function toTollInsert(t: ExtractedToll, network: 'ezpass' | 'drivewyze', userId: string): TollInsert {
  return {
    user_id: userId,
    network,
    toll_date: t.date ?? null,
    amount: num(t.amount),
    plaza: t.plaza ?? t.location ?? null,
  };
}

export function mapSettlement(d: Extraction, userId: string, truckId: string | null): SettlementMapping {
  const s = d.settlement ?? {};

  const settlement: SettlementInsert = {
    user_id: userId,
    truck_id: truckId,
    week_ending: s.weekEnding || d.date || '',
    gross: num(s.grossRevenue),
    net: num(s.netPay),
    miles: num(s.totalMiles),
  };

  const loads: LoadInsert[] = (s.loads ?? []).map((l) => ({
    user_id: userId,
    settlement_id: null,
    load_date: l.pickupDate ?? l.date ?? d.date ?? null,
    order_number: l.order ?? null,
    origin: l.from ?? null,
    destination: l.to ?? null,
    loaded_miles: num(l.loadedMiles),
    empty_miles: num(l.emptyMiles),
    revenue: num(l.revenue),
  }));

  const fuel: FuelPurchaseInsert[] = [
    ...(s.tractorFuel ?? []).map((f) => toFuelInsert(f, 'tractor', userId, truckId, d.date)),
    ...(s.reeferFuel ?? []).map((f) => toFuelInsert(f, 'reefer', userId, truckId, d.date)),
  ];

  // Settlement-withheld line items — CLAUDE.md invariant #1 (net-pay
  // model): source='settlement' so these are display-only, never
  // re-counted as an out-of-pocket tax deduction (income is already NET).
  const deductions: DeductionInsert[] = (s.deductions ?? []).map((x) => ({
    user_id: userId,
    settlement_id: null,
    ded_date: d.date ?? null,
    code: x.code ?? null,
    description: x.desc ?? null,
    amount: num(x.amount),
    category: x.category ?? null,
    payment_method: 'Settlement Withheld',
    source: 'settlement',
  }));

  const maintenance: MaintenanceRecordInsert[] = (s.maintenance ?? []).map((m) => ({
    user_id: userId,
    truck_id: truckId,
    service_date: d.date ?? null,
    service_type: toDbServiceType(m.serviceType || detectMaintType(m.desc)),
    description: m.desc ?? null,
    odometer: num(m.odometer),
    cost: num(m.total),
    invoice_number: m.invoice ?? null,
  }));

  const tolls: TollInsert[] = [
    ...(s.tolls?.ezpass?.items ?? []).map((t) => toTollInsert(t, 'ezpass', userId)),
    ...(s.tolls?.drivewyze?.items ?? []).map((t) => toTollInsert(t, 'drivewyze', userId)),
  ];

  const loans: LoanInsert[] = (s.loans ?? []).map((l) => ({
    user_id: userId,
    name: l.name,
    balance: l.balance ?? null,
    payment: l.payment ?? null,
    frequency: l.frequency ?? null,
    next_due: l.nextDue || null,
  }));

  return { settlement, loads, fuel, deductions, maintenance, tolls, loans, netPay: num(s.netPay) };
}

// ---------- standalone fuel (legacy saveImport() fuel branch, legacy/index.html:2528-2530) ----------
export function mapFuel(d: Extraction, userId: string, truckId: string | null): FuelPurchaseInsert {
  const f = d.fuel ?? {};
  return {
    user_id: userId,
    truck_id: truckId,
    settlement_id: null,
    fuel_type: f.type === 'reefer' ? 'reefer' : 'tractor',
    purchase_date: d.date ?? null,
    location: f.station ?? null,
    state: f.state ?? null,
    gallons: f.gallons ?? null,
    amount: f.gross ?? null,
    discount: num(f.discount),
  };
}

// ---------- standalone maintenance (legacy saveImport() maintenance branch, legacy/index.html:2531-2537) ----------
export type MaintenanceMapping = {
  maintenance: MaintenanceRecordInsert;
  reimbursement: ReimbursementInsert | null;
};

export function mapMaintenance(d: Extraction, userId: string, truckId: string | null): MaintenanceMapping {
  const m = d.maintenance ?? {};
  const maintenance: MaintenanceRecordInsert = {
    user_id: userId,
    truck_id: truckId,
    service_date: d.date ?? null,
    service_type: toDbServiceType(m.serviceType || detectMaintType(m.description)),
    description: m.description ?? null,
    odometer: num(m.odometer),
    cost: num(m.total),
    vendor: m.shop ?? null,
    invoice_number: m.invoice ?? null,
  };
  const reimbursement: ReimbursementInsert | null =
    m.warrantyCredit && m.warrantyCredit > 0
      ? {
          user_id: userId,
          reimb_date: d.date ?? null,
          description: `Warranty — ${m.description ?? ''}`,
          reference: m.invoice ?? null,
          amount: m.warrantyCredit,
        }
      : null;
  return { maintenance, reimbursement };
}

// ---------- store/amazon purchase (legacy saveImport() purchase branch, legacy/index.html:2538-2575) ----------
export type PurchaseDeductionMapping = {
  insert: DeductionInsert;
  isPersonalPayment: boolean;
};

// Unlike legacy (which leaves `source` unset for these), we tag
// source='import' — our schema (docs/SCHEMA.sql) added that value
// specifically to distinguish AI-imported deductions from hand-typed
// ones; legacy never had that distinction to make.
export function mapPurchase(d: Extraction, userId: string): PurchaseDeductionMapping[] {
  const p = d.purchase ?? {};
  const storeName = d.vendor || d.docType;
  const payMethod = p.paymentMethod || 'Business Credit';
  const personal = isPersonalPayment(payMethod);
  const items = p.items && p.items.length > 0 ? p.items : [{ name: d.summary || 'Purchase', price: d.totalAmount, qty: 1 }];

  const result: PurchaseDeductionMapping[] = [];
  let itemsSum = 0;

  for (const item of items) {
    const cat = guessCategory(item.name, storeName);
    const qty = Math.max(1, parseInt(String(item.qty ?? 1), 10) || 1);
    const cost = num(item.price) * qty;
    if (cost > 0) {
      const note = getCatNote(cat);
      const qtyLabel = qty > 1 ? `${qty}× ` : '';
      const desc = `${qtyLabel}${item.name ?? ''} — ${note} | ${storeName} | ${payMethod}${personal ? ' — Owner Contribution' : ''}`;
      result.push({
        insert: {
          user_id: userId,
          ded_date: d.date ?? null,
          code: 'EQUIP',
          description: desc,
          amount: cost,
          category: cat,
          store: storeName,
          payment_method: payMethod,
          source: 'import',
        },
        isPersonalPayment: personal,
      });
      itemsSum += cost;
    }
  }

  // Sales tax/fees make up the rest of the invoice total so nothing is
  // silently lost (CLAUDE.md invariant #3): use the explicit tax field if
  // extracted, else book the gap between the grand total and the item sum.
  const grand = num(p.total, num(d.totalAmount));
  const extra = p.tax && p.tax > 0 ? p.tax : grand > itemsSum + 0.01 ? Number((grand - itemsSum).toFixed(2)) : 0;
  if (extra > 0.009) {
    const desc = `Sales tax & fees | ${storeName} | ${payMethod}${personal ? ' — Owner Contribution' : ''}`;
    result.push({
      insert: {
        user_id: userId,
        ded_date: d.date ?? null,
        code: 'EQUIP',
        description: desc,
        amount: extra,
        category: 'Misc',
        store: storeName,
        payment_method: payMethod,
        source: 'import',
      },
      isPersonalPayment: personal,
    });
  }

  return result;
}

// ---------- generic fallback (legacy saveImport() else branch, legacy/index.html:2576-2578) ----------
// Covers toll/loan/w2/other — legacy's actual save path (as opposed to the
// DTYPES preview labels, which hint at richer routing that was never
// built) treats all of these as one generic deduction. The one exception:
// w2 is INCOME, not an expense — booking it as a deduction would be
// actively wrong, so it's excluded here and handled by the caller (saves
// the document only, no financial row, until Household Income has a
// screen to attach it to).
export function mapGenericDeduction(d: Extraction, userId: string): DeductionInsert {
  return {
    user_id: userId,
    ded_date: d.date ?? null,
    code: 'OTHER',
    description: d.summary || 'Document',
    amount: num(d.totalAmount),
    category: 'Other',
    source: 'import',
  };
}
