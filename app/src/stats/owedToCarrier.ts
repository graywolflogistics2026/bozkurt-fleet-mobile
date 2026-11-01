import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';
import { heldAccountKey, type HeldSettlement } from '@/src/stats/heldByCarrier';

// OWED TO CARRIER (owner decision 2026-10-31, batch D2 part 1) — READ,
// NEVER COMPUTED, Prime only. Replaces the Home hero's old figure, which
// SUMMED every negative weekly deposit inside the selected period
// (kpi.ts `owedToCarrier`), so one old negative week showed forever.
//
// Per carrier account (carrier + printed unit, else the truck — the same
// key as "held by carrier"): the settlement with the GREATEST week_ending
// that carries a printed TOTAL CASH FLOW. owed = max(0, −TOTAL CASH FLOW),
// shown "as of <week ending>". A later week that recovers the balance
// makes it vanish. Weekly nets are never summed. Other carriers: nothing
// (no printed cash-flow line to read).

export type OwedAccount = { key: string; truckId: string | null; owed: number; asOf: string };
export type OwedToCarrier = { total: number; asOf: string | null; accounts: OwedAccount[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function printedTotalCashFlow(s: Pick<HeldSettlement, 'statement'>): number | null {
  const v = s.statement?.prime?.totals?.totalCashFlow;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// truckScope: null = fleet; a truck id = that truck plus fleet-level
// (NULL-truck) rows (CLAUDE.md NULL-truck rule).
export function owedToCarrier(settlements: HeldSettlement[], truckScope: string | null): OwedToCarrier {
  const rows = settlements.filter(
    (s) => isPrimeCarrier(s.carrier) && !!s.week_ending && (truckScope == null || s.truck_id === truckScope || s.truck_id == null)
  );
  const byAccount = new Map<string, HeldSettlement[]>();
  for (const s of rows) {
    const key = heldAccountKey(s);
    byAccount.set(key, [...(byAccount.get(key) ?? []), s]);
  }
  // Same merge rule as heldByCarrier: a week saved without a truck joins
  // the carrier's one account when there is exactly one.
  for (const key of [...byAccount.keys()].filter((k) => k.endsWith('|truck:none'))) {
    const carrier = key.split('|')[0];
    const others = [...byAccount.keys()].filter((k) => k !== key && k.startsWith(`${carrier}|`));
    if (others.length !== 1) continue;
    byAccount.set(others[0], [...byAccount.get(others[0])!, ...byAccount.get(key)!]);
    byAccount.delete(key);
  }
  const accounts: OwedAccount[] = [];
  for (const [key, list] of byAccount) {
    const latest = [...list]
      .filter((s) => printedTotalCashFlow(s) != null)
      .sort((a, b) => b.week_ending.localeCompare(a.week_ending))[0];
    if (!latest) continue;
    const owed = round2(Math.max(0, -printedTotalCashFlow(latest)!));
    if (owed > 0) accounts.push({ key, truckId: list.find((s) => s.truck_id)?.truck_id ?? null, owed, asOf: latest.week_ending });
  }
  return {
    total: round2(accounts.reduce((sum, a) => sum + a.owed, 0)),
    asOf: accounts.map((a) => a.asOf).sort().at(-1) ?? null,
    accounts: accounts.sort((a, b) => a.key.localeCompare(b.key)),
  };
}
