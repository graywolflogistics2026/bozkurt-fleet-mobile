// TRAILING-MINUS AMOUNTS (golden settlement pass, owner decision
// 2026-10-13, every carrier). Carrier statements print a credit with the
// minus sign AFTER the number ("184.85-" = −184.85; Prime's fuel-discount
// lines UD/RD/ED). `parseFloat("184.85-")` reads +184.85, which turned
// every credit into a charge whenever the model copied the printed text
// as a string. This is the ONE parser the settlement mapper and the
// import checks share, so a saved row and the check that approved it can
// never read the same text differently. Anything else keeps the previous
// behavior exactly.
// 2026-10-30 (batch 0b.4): it now delegates to the ONE shared parser,
// src/lib/number.ts — "3,212.19" used to read as 3 (parseFloat stops at
// the comma); thousands separators, parentheses and a leading $ now read
// correctly, and text that is not a number is NaN, never a partial read.
import { numOrNull } from '@/src/lib/number';

// NaN when the value is not numeric — callers decide the fallback.
export function parseAmount(v: unknown): number {
  return numOrNull(v) ?? NaN;
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
