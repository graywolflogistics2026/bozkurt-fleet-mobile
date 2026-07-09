// Owner decision 2026-07-07 (web app v2026.07.07-H) — payment methods
// collapse to exactly these 9 generic values. Never a bank-brand string
// like "BofA Business" (CLAUDE.md invariant #2).
export const PAYMENT_METHODS = [
  'Business Checking',
  'Business Credit Card',
  'Personal Checking',
  'Personal Credit Card',
  'Cash',
  'Venmo',
  'Cash App',
  'Zelle Personal',
  'Zelle Business',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const PAYMENT_METHOD_SET = new Set<string>(PAYMENT_METHODS);

// Legacy/free-text payment strings (BofA-era UI, earlier AI-import output,
// hand-typed values) mapped onto the 9 generic values above. Keyed
// lowercase; looked up after trimming the input.
const LEGACY_PAYMENT_MAP: Record<string, PaymentMethod> = {
  'bofa business': 'Business Credit Card',
  'bofa business credit': 'Business Credit Card',
  'bofa business debit': 'Business Checking',
  'bofa personal': 'Personal Credit Card',
  'business credit': 'Business Credit Card',
  'business debit': 'Business Checking',
  'personal card': 'Personal Credit Card',
  'personal debit': 'Personal Checking',
  'venmo personal': 'Venmo',
  'venmo business': 'Venmo',
  'cash app personal': 'Cash App',
  'cash app business': 'Cash App',
  'cashapp': 'Cash App',
  'paypal personal': 'Personal Credit Card', // no PayPal bucket among the 9 — closest personal-funds analog
  'zelle': 'Zelle Personal',
};

// legacy/index.html:994 (as of this port) — payment methods meaning "paid
// from the owner's own personal money", not the business account/card.
// Triggers the Capital Account contribution rule (CLAUDE.md invariant #2).
// The NOT-business guard matters: "Zelle Business" matches /zelle/i but
// must read as business-paid, not personal.
export function isPersonalPayment(payment: string | undefined | null): boolean {
  const p = payment ?? '';
  return !/business/i.test(p) && /personal|cash|zelle|venmo/i.test(p);
}

// Normalizes any payment-method string (AI-extracted, legacy backup, or
// hand-typed) onto one of the 9 generic values. Cards with no further
// signal default to "Business Credit Card"; unrecognized values fall back
// there too rather than surfacing a raw bank-brand string in the UI.
export function normalizePaymentMethod(raw: string | undefined | null): PaymentMethod {
  const trimmed = (raw ?? '').trim();
  if (PAYMENT_METHOD_SET.has(trimmed)) return trimmed as PaymentMethod;
  const mapped = LEGACY_PAYMENT_MAP[trimmed.toLowerCase()];
  return mapped ?? 'Business Credit Card';
}
