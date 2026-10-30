// ONE SHARED NUMBER PARSER (owner decision 2026-10-30, master plan batch
// 0b.4). Every amount the app reads from text — AI extraction values,
// carrier statement figures, legacy backups, form inputs — goes through
// `numOrNull()` / `num()`. `parseFloat("3,212.19")` is 3 and
// `parseFloat("184.85-")` is +184.85; both are wrong numbers, which is
// worse than no number (CLAUDE.md working rule 3: null never beats a
// number, and a wrong number must never pass for a real one).
//
// Accepted: thousands separators ("3,212.19"), a trailing minus
// ("184.85-", carrier credits), parentheses ("(12.50)"), a leading $ or
// sign ("$1,884.73", "-$5", "$-5"), stray spaces, a missing leading zero
// (".37", ".37-"). Anything else — "N/A", "", "1,2", "12abc", two signs —
// is null, never a guess.

const PLAIN_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d*)?$/;

export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/\s+/g, '');
  if (!s) return null;

  let negative = false;
  let signs = 0;
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1);
    negative = true;
    signs++;
  }
  if (s.endsWith('-')) {
    s = s.slice(0, -1);
    negative = true;
    signs++;
  }
  // Leading sign and $ in either order: "-$5", "$-5", "+$5".
  for (let i = 0; i < 2; i++) {
    if (s.startsWith('$')) s = s.slice(1);
    else if (s.startsWith('-')) {
      s = s.slice(1);
      negative = true;
      signs++;
    } else if (s.startsWith('+')) s = s.slice(1);
  }
  if (signs > 1) return null;
  if (!/\d/.test(s) || !PLAIN_RE.test(s)) return null;

  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// For NOT NULL columns and sums: the fallback (default 0) when the text is
// not a number.
export function num(v: unknown, fallback = 0): number {
  return numOrNull(v) ?? fallback;
}
