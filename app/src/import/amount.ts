// TRAILING-MINUS AMOUNTS (golden settlement pass, owner decision
// 2026-10-13, every carrier). Carrier statements print a credit with the
// minus sign AFTER the number ("184.85-" = −184.85; Prime's fuel-discount
// lines UD/RD/ED). `parseFloat("184.85-")` reads +184.85, which turned
// every credit into a charge whenever the model copied the printed text
// as a string. This is the ONE parser the settlement mapper and the
// import checks share, so a saved row and the check that approved it can
// never read the same text differently. Anything else keeps the previous
// behavior exactly (a plain number, or `parseFloat` of a string).
// A leading dot is allowed: Prime prints amounts under $1 as ".37".
const TRAILING_MINUS_RE = /^\s*(\d[\d.,]*|\.\d+)\s*-\s*$/;

// NaN when the value is not numeric — callers decide the fallback.
export function parseAmount(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const trailing = v.match(TRAILING_MINUS_RE);
  if (trailing) return -parseFloat(trailing[1]);
  return parseFloat(v);
}

// A printed total for a check: null when the statement did not print it
// (missing, non-numeric, or the schema's 0 default) — a null total never
// fails a check and is never guessed.
export function printedTotal(v: unknown): number | null {
  const n = parseAmount(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// Sum of line amounts, non-numeric lines counted as 0.
export function sumAmounts<T>(rows: T[] | undefined, get: (row: T) => unknown): number {
  return (rows ?? []).reduce((sum, row) => {
    const n = parseAmount(get(row));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}
