// REFERRAL PROGRAM (owner decision 2026-08-24) — pure, testable pieces.
// Code generation/validation itself is ALSO done server-side in the
// handle_new_user() Postgres trigger (docs/PENDING_SQL.md §50) — that's
// the actual source of truth for a code stamped onto a real profiles row,
// since it must be atomic-with-uniqueness-check at the DB level (a client
// can't safely guarantee uniqueness on its own). This module exists for:
// (a) validating a code a user TYPES IN at sign-up before ever hitting the
// network (friendly inline error, no round-trip needed to reject "not
// even the right shape"), and (b) as the exact format spec the SQL
// trigger's own generator must match — same "prefix-DASH-4 chars" shape.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids visual ambiguity when read aloud or handwritten
const CODE_PREFIX = 'BOZKA';

export function isValidReferralCodeFormat(code: string): boolean {
  const trimmed = code.trim().toUpperCase();
  const pattern = new RegExp(`^${CODE_PREFIX}-[${CODE_CHARS}]{4}$`);
  return pattern.test(trimmed);
}

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

// Client-side generator is only used by tests / as a reference
// implementation — see the header comment above for why the DB trigger,
// not this function, is what actually stamps a code onto a real account.
export function generateReferralCode(randomFn: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += CODE_CHARS[Math.floor(randomFn() * CODE_CHARS.length)];
  }
  return `${CODE_PREFIX}-${suffix}`;
}
