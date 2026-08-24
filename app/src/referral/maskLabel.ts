// REFERRAL PROGRAM — MASKED IDENTITY (owner decision 2026-08-24): the
// referrer must NEVER see the referred person's real name/email — only a
// masked label ("A. B." style initials, or the signup month when no name
// is available yet). Computed server-side (the referral-sync Edge
// Function, which alone has service_role access to the referred person's
// real owner_name) and stored directly on the referrals row
// (`referred_label`) — RLS on `profiles` already independently prevents
// the referrer from ever reading the referred person's actual profile
// row via a client-side join, so this label is the ONLY identity signal
// that ever reaches the referrer. Pure/testable so the masking rule
// itself has a regression guard independent of the Edge Function's own
// (untestable, Deno-only) orchestration code.
export function buildMaskedReferralLabel(ownerName: string | null | undefined, signupCreatedAt: string): string {
  const trimmed = ownerName?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const initials = parts.map((p) => `${p[0].toUpperCase()}.`).join(' ');
    if (initials) return initials;
  }
  const date = new Date(signupCreatedAt);
  const month = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `New member (${month})`;
}
