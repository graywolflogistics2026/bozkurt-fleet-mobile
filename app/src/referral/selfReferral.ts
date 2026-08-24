// REFERRAL PROGRAM — ANTI-ABUSE (owner decision 2026-08-24): blocks the
// most common self-referral trick (Gmail-style "+tag"/"." variations of
// the same inbox, or plain case differences) from counting as a real
// referral. This is a HEURISTIC, not a guarantee — deliberately documented
// as such rather than oversold. Device-install-id matching ("where
// available" in the spec) is NOT implemented in this pass: neither
// expo-application nor expo-device is an existing dependency in this repo
// (confirmed by grep), and adding either is a new native module requiring
// a fresh build, not an OTA-safe change — flagged as a deferred follow-up
// rather than silently skipped.
//
// The SAME normalization is re-implemented in SQL inside the
// handle_new_user() trigger (docs/PENDING_SQL.md §50), since that's where
// a referrals row actually gets created at signup — this TS copy is for
// unit testing the exact rule and for any future client-side pre-check
// (e.g. rejecting an obviously-self code before ever calling signUp()).
// Every Edge Function in this codebase is already self-contained/
// duplicates small helpers rather than importing from app/src (see
// delete-account/reset-data's own deleteStorageFolder() precedent) — the
// SQL trigger follows that same established convention here.
function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split('@');
  if (!domain) return trimmed;
  // Gmail (and Google Workspace) ignore dots and treat anything after "+"
  // as a tag — collapsing both makes "a.b+trucking@gmail.com" and
  // "ab@gmail.com" compare equal, the single most common self-referral
  // trick. Non-Gmail domains only get the "+tag" strip (a broadly
  // supported convention across most providers), never the dot-strip
  // (which is NOT safe to assume for arbitrary domains).
  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  let normalizedLocal = local.split('+')[0];
  if (isGmail) normalizedLocal = normalizedLocal.replace(/\./g, '');
  // gmail.com and googlemail.com are the same mailbox space (Google's own
  // legacy alias) — unify to one canonical domain so a comparison across
  // the two still catches the same inbox.
  const normalizedDomain = isGmail ? 'gmail.com' : domain;
  return `${normalizedLocal}@${normalizedDomain}`;
}

export function isLikelySelfReferral(referrerEmail: string, referredEmail: string): boolean {
  if (!referrerEmail || !referredEmail) return false;
  return normalizeEmail(referrerEmail) === normalizeEmail(referredEmail);
}
