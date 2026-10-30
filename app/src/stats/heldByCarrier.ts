// HELD BY CARRIER (owner decision 2026-10-29) — the ONE figure for what a
// carrier holds of the operator's money (bond / emergency fund / escrow).
// Replaces calcEscrowBalance(), which summed every weekly escrow deduction
// (re-imports, other trucks, manual and other-carrier rows inflated it).
//
// Per carrier account (carrier + the unit printed on the statement, else
// the truck): the printed held balance of the settlement with the GREATEST
// week_ending that has one and whose escrow checks did not fail, shown "as
// of <week ending>". Fleet = the sum of each account's latest. Importing an
// older week later, or the same week twice (with or without a truck),
// never changes it. Accounts with no printed balance (weeks imported before
// the statement route, other carriers) give an "estimate from imported
// weeks" — labeled, one statement per week, never a silent sum.
import { settlementDeposit, type SettlementStatement } from '@/src/import/settlementStatement';
import { normalizeCarrierKey } from '@/src/import/carrierCodes';

export type HeldSettlement = {
  id: string;
  truck_id: string | null;
  week_ending: string;
  carrier: string | null;
  statement?: SettlementStatement | null;
};
export type HeldDeduction = { settlement_id?: string | null; source?: string | null; category: string | null; amount: number | null };

export type HeldAccount = {
  key: string;
  carrier: string | null;
  unit: string | null;
  truckId: string | null;
  held: number;
  asOf: string;
  source: 'printed' | 'estimate';
};

export type HeldByCarrier = {
  status: 'printed' | 'estimate' | 'not_printed';
  total: number | null;
  // The newest as-of date among the accounts.
  asOf: string | null;
  accounts: HeldAccount[];
  // Weeks whose printed figure failed its escrow checks (skipped).
  unverifiedWeeks: string[];
};

const ESCROW_CATEGORY = 'Escrow & Deposits';
const round2 = (n: number) => Math.round(n * 100) / 100;

export function heldAccountKey(s: HeldSettlement): string {
  const unit = s.statement?.escrow?.unit ?? s.statement?.unit ?? null;
  return `${normalizeCarrierKey(s.carrier) ?? '?'}|${unit ? `unit:${unit}` : `truck:${s.truck_id ?? 'none'}`}`;
}

// truckScope: null = fleet; a truck id = that truck plus fleet-level
// (NULL-truck) rows. window: only settlements with week_ending inside it
// ("held at month end" = the last settlement inside that month).
export function heldByCarrier(
  settlements: HeldSettlement[],
  truckScope: string | null,
  options: { window?: { startIso?: string | null; endIso?: string | null } | null; deductions?: HeldDeduction[] } = {}
): HeldByCarrier {
  const start = options.window?.startIso ?? null;
  const end = options.window?.endIso ?? null;
  const rows = settlements.filter(
    (s) =>
      (truckScope == null || s.truck_id === truckScope || s.truck_id == null) &&
      (!start || s.week_ending >= start) &&
      (!end || s.week_ending <= end)
  );
  const byAccount = new Map<string, HeldSettlement[]>();
  for (const s of rows) {
    const key = heldAccountKey(s);
    byAccount.set(key, [...(byAccount.get(key) ?? []), s]);
  }
  // A week saved without a truck belongs to the one account of the same
  // carrier when there is exactly one (the same week imported with and
  // without a truck is one statement, never two balances).
  for (const key of [...byAccount.keys()].filter((k) => k.endsWith('|truck:none'))) {
    const carrier = key.split('|')[0];
    const others = [...byAccount.keys()].filter((k) => k !== key && k.startsWith(`${carrier}|`));
    if (others.length !== 1) continue;
    byAccount.set(others[0], [...byAccount.get(others[0])!, ...byAccount.get(key)!]);
    byAccount.delete(key);
  }

  const accounts: HeldAccount[] = [];
  const unverifiedWeeks = new Set<string>();
  for (const [key, list] of byAccount) {
    const sorted = [...list].sort((a, b) => b.week_ending.localeCompare(a.week_ending));
    for (const s of sorted) if (s.statement?.escrow?.status === 'unverified') unverifiedWeeks.add(s.week_ending);
    const latest = sorted.find((s) => s.statement?.escrow?.held != null && s.statement.escrow.status !== 'unverified');
    const truckId = sorted.find((s) => s.truck_id)?.truck_id ?? null;
    if (latest) {
      accounts.push({
        key,
        carrier: latest.carrier,
        unit: latest.statement?.escrow?.unit ?? null,
        truckId,
        held: round2(latest.statement!.escrow!.held!),
        asOf: latest.week_ending,
        source: 'printed',
      });
      continue;
    }
    const estimate = estimateFromImportedWeeks(sorted, options.deductions ?? []);
    if (estimate != null) accounts.push({ key, carrier: sorted[0].carrier, unit: null, truckId, held: estimate, asOf: sorted[0].week_ending, source: 'estimate' });
  }

  if (accounts.length === 0) return { status: 'not_printed', total: null, asOf: null, accounts, unverifiedWeeks: [...unverifiedWeeks].sort() };
  return {
    status: accounts.some((a) => a.source === 'estimate') ? 'estimate' : 'printed',
    total: round2(accounts.reduce((sum, a) => sum + a.held, 0)),
    asOf: accounts.map((a) => a.asOf).sort().at(-1) ?? null,
    accounts: accounts.sort((a, b) => a.key.localeCompare(b.key)),
    unverifiedWeeks: [...unverifiedWeeks].sort(),
  };
}

// One statement per week (the newest saved copy of a week wins), then the
// escrow lines withheld on those statements. Null when there are none.
function estimateFromImportedWeeks(sortedDesc: HeldSettlement[], deductions: HeldDeduction[]): number | null {
  const onePerWeek = new Map<string, string>();
  for (const s of sortedDesc) if (!onePerWeek.has(s.week_ending)) onePerWeek.set(s.week_ending, s.id);
  const ids = new Set(onePerWeek.values());
  const lines = deductions.filter((d) => d.category === ESCROW_CATEGORY && d.source === 'settlement' && d.settlement_id && ids.has(d.settlement_id));
  if (lines.length === 0) return null;
  return round2(lines.reduce((sum, d) => sum + Number(d.amount ?? 0), 0));
}

// DEPOSITED (owner decision 2026-10-29, B5): "Deposited to your bank" is
// the sum of per-week printed deposits — ONE per statement. The same
// statement saved twice (with and without a truck) is the same carrier,
// week, unit and printed deposit; only the first copy counts.
export function onePerStatementWeek<
  T extends { week_ending: string | null; carrier?: string | null; net?: number | null; statement?: SettlementStatement | null },
>(settlements: T[]): T[] {
  const seen = new Set<string>();
  return settlements.filter((s) => {
    const deposit = settlementDeposit(s);
    const cents = Math.round((deposit.deposited - deposit.owedToCarrier) * 100);
    const key = `${normalizeCarrierKey(s.carrier) ?? '?'}|${s.week_ending ?? ''}|${s.statement?.unit ?? ''}|${cents}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "Held by carrier at month end" (accountant package, month views).
export function heldAtMonthEnd(
  settlements: HeldSettlement[],
  truckScope: string | null,
  year: number,
  month: number,
  deductions?: HeldDeduction[]
): HeldByCarrier {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return heldByCarrier(settlements, truckScope, { window: { startIso: `${year}-${mm}-01`, endIso: `${year}-${mm}-${lastDay}` }, deductions });
}
