// PDF CreationDate (owner decision 2026-10-29, DATES item A2): the date the
// carrier's system wrote the file, read from the Info dictionary
// ("/CreationDate (D:20260813235659-05'00')") as the local calendar date it
// prints, YYYY-MM-DD. Real Prime files: 2026-08-13 and 2026-08-20/21, a day
// or so after the print DATE. Null when absent (e.g. a compressed Info
// object or a photo) — the check is then skipped, never guessed.
const CREATION_DATE_RE = /\/CreationDate\s*\(\s*D:(\d{4})(\d{2})(\d{2})/;

export function pdfCreationDateOf(bytes: Uint8Array): string | null {
  // The Info dictionary is plain text near the start or the end of the file.
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 65_536)));
  const tail = bytes.length > 65_536 ? latin1(bytes.subarray(Math.max(65_536, bytes.length - 65_536))) : '';
  const m = CREATION_DATE_RE.exec(head) ?? CREATION_DATE_RE.exec(tail);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}
