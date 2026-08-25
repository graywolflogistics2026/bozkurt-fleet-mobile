// USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
// FIVE ADDITIONS pass, PART 5). Pure, testable math only — the actual
// server-side enforcement lives in supabase/functions/ai-import/index.ts
// (Deno can't import this module, same "each Edge Function is self-
// contained, mirrors the pure TS logic with a cross-reference comment"
// convention as delete-account/reset-data's deleteStorageFolder() and
// referral-sync's own qualification/reward mirrors). This module is what
// the CLIENT reads to render usage/credits in Settings and to decide when
// to offer a credit pack — the server's own count (COUNT(*) from
// ai_usage_log, never a client-writable counter) is what actually gates
// whether an ai-import call is allowed, per the spec's "counters live
// server-side, never client-side."

// Server-configurable default (docs/PENDING_SQL.md's ai_usage_config
// table) — this constant is only the CLIENT's own display fallback before
// that config row has loaded; the server's own copy of this number is the
// one that actually governs the gate.
export const DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH = 60;

// "1 = 60, 3 = 180, 8 = 480" — at least one truck's worth even at 0 active
// trucks (matches this app's n=1 default-presentation spirit, CLAUDE.md
// invariant #7), capped by an optional server-set account ceiling.
export function calcMonthlyAllowance(
  activeTruckCount: number,
  perTruck: number = DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH,
  accountCeiling: number | null = null
): number {
  const raw = Math.max(1, activeTruckCount) * perTruck;
  return accountCeiling != null ? Math.min(raw, accountCeiling) : raw;
}

// OWNER/DEV ACCOUNT FLAG (owner decision) — an 'owner' plan
// (src/entitlement/hasFullAccess.ts) bypasses the monthly allowance
// entirely: no counter, no soft-limit notice, no hard limit, no credit-
// pack prompt. Mirrored in ai-import/index.ts's own inline check (same
// "self-contained Edge Function, pure TS mirror kept here for
// testability" convention as calcMonthlyAllowance/calcUsageStatus above)
// — that server-side check remains the actual enforcement point; this
// copy is what the CLIENT reads to decide whether to even show the usage
// UI in Settings at all.
export function bypassesUsageLimit(plan: string | null | undefined): boolean {
  return plan === 'owner';
}

export const SOFT_LIMIT_PCT = 0.8;

export type UsageStatus = {
  used: number;
  allowance: number;
  pctUsed: number; // 0-1+, uncapped so a caller can tell "how far over" if ever relevant
  softLimitReached: boolean;
  hardLimitReached: boolean;
};

export function calcUsageStatus(used: number, allowance: number): UsageStatus {
  const pctUsed = allowance > 0 ? used / allowance : used > 0 ? 1 : 0;
  return { used, allowance, pctUsed, softLimitReached: pctUsed >= SOFT_LIMIT_PCT, hardLimitReached: used >= allowance };
}

// SERVER-SIDE GATE LOGIC (mirrored verbatim in ai-import/index.ts's own
// inline copy, see that file's own comment) — "count only real AI calls: a
// multi-page settlement counts ONCE; retries after a service failure don't
// count." A response only ever counts once it's genuinely TERMINAL
// (`hasNextPageStart` false — the multi-page continuation protocol is
// done) AND succeeded (no error). A continuation round, or any failed
// round, never increments — a settlement that eventually succeeds after
// several rounds/retries is billed exactly once, on its final round; one
// that never completes is never billed at all.
export function shouldCountAiImportUsage(hasNextPageStart: boolean, hadError: boolean): boolean {
  return !hasNextPageStart && !hadError;
}

// "Counters reset monthly" — usage is COUNT(*) from ai_usage_log rows
// created on/after this UTC month boundary, so nothing needs an explicit
// reset job; a new calendar month naturally excludes every older row.
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type CreditPack = {
  id: string;
  creditsRemaining: number;
  expiresAt: string | null; // null = never expires (the 3 fixed-size packs); set only for the Catch-Up Year pack
};

// "Packs are consumed ONLY after the monthly allowance is exhausted."
export function canUseAi(usage: UsageStatus, availableCredits: number): boolean {
  return !usage.hardLimitReached || availableCredits > 0;
}

export function isCreditPackExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  return !!expiresAt && new Date(expiresAt) <= now;
}

export function sumAvailableCredits(packs: CreditPack[], now: Date = new Date()): number {
  return packs.filter((p) => !isCreditPackExpired(p.expiresAt, now)).reduce((sum, p) => sum + p.creditsRemaining, 0);
}

// Which pack a real AI call should draw its one credit from — soonest-to-
// expire first ("use it or lose it"), skipping anything already expired or
// empty. Never-expiring packs are used last (no urgency to spend them).
export function planCreditConsumption(packs: CreditPack[], now: Date = new Date()): { packId: string } | null {
  const usable = packs.filter((p) => p.creditsRemaining > 0 && !isCreditPackExpired(p.expiresAt, now));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => {
    if (!a.expiresAt && !b.expiresAt) return 0;
    if (!a.expiresAt) return 1;
    if (!b.expiresAt) return -1;
    return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
  });
  return { packId: sorted[0].id };
}

export const CATCH_UP_PACK_VALID_DAYS = 90;

export function calcCatchUpPackExpiry(grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + CATCH_UP_PACK_VALID_DAYS * 24 * 60 * 60 * 1000);
}

// Credit pack catalog (spec item 5.4) — prices/credit counts are the
// CLIENT's own display copy; the server's admin-granted rows
// (docs/ADMIN_RUNBOOK.md recipe) are the actual source of truth for what a
// specific purchase grants, same "prices configurable server-side" spirit
// as tax_year_data's own constants.
export type CreditPackOffer = { id: 'pack_25' | 'pack_100' | 'pack_300' | 'catchup_year'; credits: number; priceUsd: number; validDays: number | null };
export const CREDIT_PACK_OFFERS: CreditPackOffer[] = [
  { id: 'pack_25', credits: 25, priceUsd: 9, validDays: null },
  { id: 'pack_100', credits: 100, priceUsd: 25, validDays: null },
  { id: 'pack_300', credits: 300, priceUsd: 59, validDays: null },
  { id: 'catchup_year', credits: 1000, priceUsd: 99, validDays: CATCH_UP_PACK_VALID_DAYS },
];

// Fleet-size subscription tiers (spec item 5.6) — recorded here as the
// client's own display/reference copy of the tier basis; no billing
// provider is wired up yet (Session 10, PROMPTS.md).
export type FleetTier = { id: 'solo' | 'small_fleet' | 'fleet' | 'fleet_plus'; label: string; truckRange: string; basePriceUsd: number; perExtraTruckUsd: number };
export const FLEET_TIERS: FleetTier[] = [
  { id: 'solo', label: 'Solo', truckRange: '1', basePriceUsd: 19, perExtraTruckUsd: 0 },
  { id: 'small_fleet', label: 'Small Fleet', truckRange: '2-3', basePriceUsd: 39, perExtraTruckUsd: 0 },
  { id: 'fleet', label: 'Fleet', truckRange: '4-8', basePriceUsd: 79, perExtraTruckUsd: 0 },
  { id: 'fleet_plus', label: 'Fleet+', truckRange: '9+', basePriceUsd: 79, perExtraTruckUsd: 8 },
];

// MULTI-FILE BACKGROUND IMPORT (owner decision, "batch enqueue" pass) —
// how many of a picked batch of N documents will actually be allowed to
// process right now, given the account's current usage/credits, computed
// WITHOUT starting a single job — "say up front how many will process...
// rather than silently truncating" (spec item 4). A batch of N documents
// always counts N against capacity here even though a single multi-page
// settlement only ever counts ONCE server-side (shouldCountAiImportUsage
// above) — that rule is about one document's own page count, not about how
// many separate documents a batch contains. This is a client-side ESTIMATE
// for the up-front message only; the real, authoritative gate is still the
// server's own per-document check inside ai-import at the moment each job
// actually runs (never weakened or bypassed by this pre-check).
export type BatchImportCapacity = {
  batchSize: number;
  willProcess: number;
  willBeBlocked: number;
  usesCredits: number; // how many of willProcess draw from credits rather than the monthly allowance
};

export function planBatchImportCapacity(
  batchSize: number,
  usage: UsageStatus,
  availableCredits: number,
  bypassesLimit = false
): BatchImportCapacity {
  if (bypassesLimit) return { batchSize, willProcess: batchSize, willBeBlocked: 0, usesCredits: 0 };
  const remainingAllowance = Math.max(0, usage.allowance - usage.used);
  const capacity = remainingAllowance + Math.max(0, availableCredits);
  const willProcess = Math.max(0, Math.min(batchSize, capacity));
  const usesCredits = Math.max(0, willProcess - remainingAllowance);
  return { batchSize, willProcess, willBeBlocked: batchSize - willProcess, usesCredits };
}

// "Contextually when someone is clearly back-filling (several imports
// dated in a past month in one session)" — spec item 5.5. Pure detector:
// counts how many of the given import dates fall in a month before the
// current one; 3+ is treated as "clearly back-filling."
export const BACKFILL_DETECTION_THRESHOLD = 3;

export function detectBackfillSession(importedDocDates: string[], now: Date = new Date()): boolean {
  const monthStart = monthStartUtc(now);
  const pastMonthCount = importedDocDates.filter((d) => new Date(`${d}T00:00:00Z`) < monthStart).length;
  return pastMonthCount >= BACKFILL_DETECTION_THRESHOLD;
}
