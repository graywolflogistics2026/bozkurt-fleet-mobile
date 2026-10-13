// BANK DEPOSIT IS READ, NEVER COMPUTED (owner decision 2026-10-13): the
// app reads a deposit AMOUNT only. A statement's deposit line also prints
// bank digits ("DIRECT DEPOSIT TO BANK ROUTING #111000025"); if the model
// copies such text into any free-text field (summary, a description), it
// must never be stored. scrubBankDigits() runs on every extraction before
// it is saved (documents.parsed_json and every row derived from it):
// digits that follow a routing/account/ABA label are replaced.
export const BANK_DIGITS_RE = /\b(routing|rtg|aba|account|acct|bank\s+acct)(\s*(?:#|no\.?|number|num)?\s*:?\s*)(\d[\d\s-]{3,}\d)/gi;

export function scrubBankDigitsInText(text: string): string {
  return text.replace(BANK_DIGITS_RE, (_m, label: string, sep: string) => `${label}${sep}[removed]`);
}

export function scrubBankDigits<T>(value: T): T {
  if (typeof value === 'string') return scrubBankDigitsInText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubBankDigits(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubBankDigits(v);
    return out as T;
  }
  return value;
}
