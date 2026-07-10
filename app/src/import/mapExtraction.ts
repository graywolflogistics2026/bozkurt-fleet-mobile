import { detectMaintType, getCatNote, guessCategory, toDbServiceType } from '@/src/import/category';
import { isPersonalPayment, normalizePaymentMethod } from '@/src/import/paymentMethods';
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
import type { Extraction, ExtractedFuel, ExtractedReimbursementItem, ExtractedToll } from '@/src/import/types';

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
  reimbursements: ReimbursementInsert[];
  tolls: TollInsert[];
  loans: LoanInsert[];
  netPay: number;
};

function toFuelInsert(
  f: ExtractedFuel,
  fuelType: 'tractor' | 'reefer',
  userId: string,
  truckId: string | null,
  driverId: string | null,
  fallbackDate?: string
): FuelPurchaseInsert {
  return {
    user_id: userId,
    truck_id: truckId,
    driver_id: driverId,
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

function toReimbInsert(r: ExtractedReimbursementItem, userId: string, fallbackDate?: string): ReimbursementInsert {
  return {
    user_id: userId,
    reimb_date: fallbackDate ?? null,
    description: r.desc ?? null,
    reference: r.ref ?? null,
    amount: num(r.amount),
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

export function mapSettlement(
  d: Extraction,
  userId: string,
  truckId: string | null,
  driverId: string | null = null
): SettlementMapping {
  const s = d.settlement ?? {};

  const settlement: SettlementInsert = {
    user_id: userId,
    truck_id: truckId,
    driver_id: driverId,
    week_ending: s.weekEnding || d.date || '',
    gross: num(s.grossRevenue),
    net: num(s.netPay),
    miles: num(s.totalMiles),
  };

  // pickup_date/delivery_date (docs/PENDING_SQL.md §8) feed the per-diem
  // day-range calc (app/src/tax/perDiem.ts) — load_date stays populated too
  // for existing display code that only reads the single column.
  const loads: LoadInsert[] = (s.loads ?? []).map((l) => {
    const pickupDate = l.pickupDate ?? l.date ?? d.date ?? null;
    const deliveryDate = l.deliveryDate ?? l.dropDate ?? pickupDate;
    return {
      user_id: userId,
      settlement_id: null,
      driver_id: driverId,
      load_date: pickupDate,
      pickup_date: pickupDate,
      delivery_date: deliveryDate,
      order_number: l.order ?? null,
      origin: l.from ?? null,
      destination: l.to ?? null,
      loaded_miles: num(l.loadedMiles),
      empty_miles: num(l.emptyMiles),
      revenue: num(l.revenue),
    };
  });

  const fuel: FuelPurchaseInsert[] = [
    ...(s.tractorFuel ?? []).map((f) => toFuelInsert(f, 'tractor', userId, truckId, driverId, d.date)),
    ...(s.reeferFuel ?? []).map((f) => toFuelInsert(f, 'reefer', userId, truckId, driverId, d.date)),
  ];

  // Settlement-withheld line items — CLAUDE.md invariant #1 (net-pay
  // model): source='settlement' so these are display-only, never
  // re-counted as an out-of-pocket tax deduction (income is already NET).
  // driver_id here (payroll auto-routing, owner decision 2026-07-09) is
  // scoped to withheld rows only — standalone purchase deductions
  // (mapPurchase, below) aren't part of a settlement and have no driver.
  const deductions: DeductionInsert[] = (s.deductions ?? []).map((x) => ({
    user_id: userId,
    settlement_id: null,
    driver_id: driverId,
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

  // legacy/index.html:2516 — a real gap, not previously ported: settlement
  // reimbursementItems were extracted but never turned into DB rows.
  const reimbursements: ReimbursementInsert[] = (s.reimbursementItems ?? []).map((r) => toReimbInsert(r, userId, d.date));

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

  return { settlement, loads, fuel, deductions, maintenance, reimbursements, tolls, loans, netPay: num(s.netPay) };
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
// Rewritten 2026-07-07 (owner decision, web app v2026.07.07-H) — REPLACES
// CLAUDE.md's old invariant #3 (a separate "Sales tax & fees" row). Tax,
// shipping/handling, and any add-on/service/protection-plan line now fold
// PROPORTIONALLY into the real items' costs so the booked total still
// equals the receipt's grand total to the cent, but no dollar sits in its
// own disconnected line either.
export type PurchaseDeductionMapping = {
  insert: DeductionInsert;
  isPersonalPayment: boolean;
};

const SERVICE_LINE_RE = /\b(service|protection plan|add-?on|installation|delivery service|assembly|gift wrap|warranty)\b/i;
const PARENT_REF_RE = /\(for\s+(.+?)\)\s*$/i;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Distributes `extra` (dollars) across `costs` proportionally by cost
// share, cents-safe: whole cents are floor-allocated per share, then any
// leftover cents go one-at-a-time to the largest-cost item(s) first so the
// sum of the returned shares always equals `extra` to the cent.
function distributeProportional(costs: number[], extra: number): number[] {
  const total = costs.reduce((s, c) => s + c, 0);
  if (total <= 0 || extra <= 0.009) return costs.map(() => 0);

  const totalCents = Math.round(extra * 100);
  const rawShares = costs.map((c) => (c / total) * totalCents);
  const shares = rawShares.map((r) => Math.floor(r));
  let remainder = totalCents - shares.reduce((s, c) => s + c, 0);

  const order = costs.map((c, i) => i).sort((a, b) => costs[b] - costs[a]);
  let i = 0;
  while (remainder > 0 && order.length > 0) {
    shares[order[i % order.length]] += 1;
    remainder--;
    i++;
  }
  return shares.map((cents) => cents / 100);
}

// Unlike legacy (which leaves `source` unset for these), we tag
// source='import' — our schema (docs/SCHEMA.sql) added that value
// specifically to distinguish AI-imported deductions from hand-typed
// ones; legacy never had that distinction to make.
export function mapPurchase(d: Extraction, userId: string): PurchaseDeductionMapping[] {
  const p = d.purchase ?? {};
  const storeName = d.vendor || d.docType;
  const payMethod = normalizePaymentMethod(p.paymentMethod);
  const personal = isPersonalPayment(payMethod);
  const rawItems = p.items && p.items.length > 0 ? p.items : [{ name: d.summary || 'Purchase', price: d.totalAmount, qty: 1 }];

  type RealItem = { name: string; qty: number; cost: number; warrantyYears?: number; extra: number };
  type ServiceLine = { name: string; cost: number; parent?: string };

  const realItems: RealItem[] = [];
  const serviceLines: ServiceLine[] = [];

  for (const item of rawItems) {
    const name = item.name ?? '';
    const qty = Math.max(1, parseInt(String(item.qty ?? 1), 10) || 1);
    const cost = num(item.price) * qty;
    if (cost <= 0.009) continue;
    if (SERVICE_LINE_RE.test(name)) {
      const parentMatch = name.match(PARENT_REF_RE);
      serviceLines.push({ name, cost, parent: parentMatch?.[1]?.trim() ?? (item as { warrantyFor?: string }).warrantyFor });
    } else {
      realItems.push({ name, qty, cost, warrantyYears: item.warrantyYears, extra: 0 });
    }
  }

  const explicitTax = num(p.tax);
  if (explicitTax > 0.009) serviceLines.push({ name: 'Sales tax', cost: explicitTax });

  const buildRow = (desc: string, amount: number, category: string, warrantyYears: number | null = null): PurchaseDeductionMapping => ({
    insert: {
      user_id: userId,
      ded_date: d.date ?? null,
      code: 'EQUIP',
      description: desc,
      amount,
      category,
      store: storeName,
      payment_method: payMethod,
      source: 'import',
      warranty_years: warrantyYears,
    },
    isPersonalPayment: personal,
  });

  // Receipt with ONLY service/fee lines — nothing to fold into. Keep them
  // as their own row(s), flagged for manual review (CLAUDE.md invariant #3).
  if (realItems.length === 0) {
    return serviceLines.map((line) =>
      buildRow(`NEEDS REVIEW: ${line.name} | ${storeName} | ${payMethod}${personal ? ' — Owner Contribution' : ''}`, line.cost, 'Misc')
    );
  }

  // A service/fee line that names its parent — e.g. "Extended warranty
  // (for Milwaukee Drill)" — folds directly into that item, not the
  // proportional pool.
  const unnamedLines: ServiceLine[] = [];
  for (const line of serviceLines) {
    const idx = line.parent ? realItems.findIndex((i) => i.name.toLowerCase().includes(line.parent!.toLowerCase())) : -1;
    if (idx >= 0) {
      realItems[idx].extra += line.cost;
    } else {
      unnamedLines.push(line);
    }
  }

  const itemsSum = realItems.reduce((s, i) => s + i.cost, 0);
  const namedFoldTotal = realItems.reduce((s, i) => s + i.extra, 0);
  const unnamedSum = unnamedLines.reduce((s, l) => s + l.cost, 0);

  // Grand total is the receipt's own stated total when present; otherwise
  // it's reconstructed from everything seen (real items + all fee/service
  // lines) so nothing is assumed lost.
  const explicitGrand = p.total ?? d.totalAmount;
  const grand = explicitGrand && explicitGrand > 0 ? num(explicitGrand) : itemsSum + namedFoldTotal + unnamedSum;

  const remainderToDistribute = Number((grand - itemsSum - namedFoldTotal).toFixed(2));
  if (remainderToDistribute > 0.009) {
    const shares = distributeProportional(
      realItems.map((i) => i.cost),
      remainderToDistribute
    );
    realItems.forEach((item, i) => {
      item.extra = Number((item.extra + shares[i]).toFixed(2));
    });
  }

  return realItems.map((item) => {
    const cat = guessCategory(item.name, storeName);
    const note = getCatNote(cat);
    const qtyLabel = item.qty > 1 ? `${item.qty}× ` : '';
    const finalCost = Number((item.cost + item.extra).toFixed(2));
    const foldSuffix = item.extra > 0.009 ? ` (incl. ${money(item.extra)} tax/fees/services)` : '';
    const desc = `${qtyLabel}${item.name} — ${note}${foldSuffix} | ${storeName} | ${payMethod}${personal ? ' — Owner Contribution' : ''}`;
    return buildRow(desc, finalCost, cat, item.warrantyYears ?? null);
  });
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
