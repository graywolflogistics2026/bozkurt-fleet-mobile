// ONE SHARED DESCRIPTION RULE (owner decision 2026-09-24, "systemic broken
// descriptions"). Every path that WRITES a deduction description / expense
// note, and every screen that SHOWS one, goes through this module, so the
// rule can't drift between entry paths:
//   - a value only counts if it contains at least one letter or digit —
//     "", "   ", "/", "-", ":", " — ", "()" are all treated as missing
//   - pieces are only joined with a separator when BOTH sides are real
//   - when nothing real is left, fall back to "<category> — <M/D>"
//     (e.g. "Utilities & Subscriptions — 9/24"), never a bare separator
// Same precedence idea as documents' resolveDocumentTitle(): the saved
// value first, then linked/extracted data, then vendor, then category/type.

const REAL_TEXT_RE = /[\p{L}\p{N}]/u;

export function hasRealText(value: unknown): value is string {
  return typeof value === 'string' && REAL_TEXT_RE.test(value);
}

// The trimmed, whitespace-collapsed value, or null if it has no real text.
export function realText(value: unknown): string | null {
  if (!hasRealText(value)) return null;
  return value.replace(/\s+/g, ' ').trim();
}

// Join only the pieces that have real text; null when none do.
export function joinReal(parts: unknown[], separator = ' — '): string | null {
  const real = parts.map(realText).filter((p): p is string => !!p);
  return real.length ? real.join(separator) : null;
}

// "2026-09-24" -> "9/24". Used for STORED fallback text written by the data
// layer (no i18n there); screens pass their own locale-aware formatter.
export function isoShortDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}` : null;
}

export type DescriptionInputs = {
  description?: string | null;
  // Linked or extracted text (e.g. the linked document's saved title).
  linked?: string | null;
  vendor?: string | null;
  category?: string | null;
  date?: string | null;
};

export type DescriptionFormat = {
  shortDate?: (iso: string) => string;
  // Used only when there is no category either (e.g. "Expense").
  fallbackLabel: string;
};

// The one resolver: saved description -> linked/extracted -> vendor (with
// category) -> "<category> — <date>" -> fallback label. Never empty and
// never a bare separator.
export function resolveDescription(inputs: DescriptionInputs, format: DescriptionFormat): string {
  const saved = realText(inputs.description);
  if (saved) return saved;
  const linked = realText(inputs.linked);
  if (linked) return linked;
  const category = realText(inputs.category);
  const when = inputs.date ? (format.shortDate ? format.shortDate(inputs.date) : isoShortDate(inputs.date)) : null;
  const vendor = realText(inputs.vendor);
  if (vendor) return joinReal([vendor, category, when]) as string;
  return joinReal([category ?? format.fallbackLabel, when]) ?? format.fallbackLabel;
}

// For WRITE paths in the data layer: the value to store. Keeps real text
// as typed/extracted (trimmed); otherwise stores the category + date
// default so no row is ever saved blank or separator-only.
export function ensureDescription(value: unknown, fallback: { category?: string | null; date?: string | null }): string {
  return resolveDescription(
    { description: typeof value === 'string' ? value : null, category: fallback.category, date: fallback.date },
    { fallbackLabel: 'Misc' }
  );
}

// A deduction's display description, for EVERY screen that shows one
// (Deductions list + edit sheet, Transactions, Settlements detail, For
// Prime Inc Drivers). Before this, screens rendered `description ?? '—'`:
// a missing description showed a bare "—", and "" or "   " a blank line.
export type DeductionTextRow = {
  description: string | null;
  store?: string | null;
  category: string | null;
  ded_date: string | null;
};

export function describeDeduction(row: DeductionTextRow, format: DescriptionFormat): string {
  return resolveDescription({ description: row.description, vendor: row.store, category: row.category, date: row.ded_date }, format);
}

// "Needs a description" review (owner decision 2026-09-24, item 5): every
// row whose STORED description has no real text, newest first. Nothing is
// rewritten until the user accepts a suggestion or types their own.
export function findDeductionsNeedingDescription<T extends DeductionTextRow & { id: string }>(rows: T[]): T[] {
  return rows
    .filter((r) => !hasRealText(r.description))
    .sort((a, b) => (b.ded_date ?? '').localeCompare(a.ded_date ?? ''));
}
