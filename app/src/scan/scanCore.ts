import { PDFDocument } from 'pdf-lib';

// AUTOMATIC DOCUMENT SCANNER (owner decision 2026-10-30, master plan batch
// E). The pure core of scanDocument(): every native/file call is injected
// (ScanDeps) so the rules are unit-tested with the module mocked
// (src/scan/__tests__/scanCore.test.ts). The real deps live in
// src/scan/scanDeps.ts; the screens call src/scan/scanDocument.ts.
//
// Rules: the scan runs on the device (Google ML Kit Document Scanner on
// Android, Apple VisionKit on iOS); at most MAX_SCAN_PAGES pages (enforced
// here, iOS has no page-cap option); each page is a JPEG at ~85% quality
// with the long edge at most ~2,200 px; 2+ pages become ONE PDF built on
// the device (pdf-lib, pure JS, embeds the JPEG bytes unchanged) and go
// through the existing resumable page-by-page import; the result must fit
// the 10 MB upload limit, compressing harder when it does not. Every temp
// file is deleted after upload or cancel (discardScan()).

export const MAX_SCAN_PAGES = 10;
export const SCAN_JPEG_QUALITY = 0.85;
export const SCAN_MAX_LONG_EDGE = 2200;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Tried in order until the file fits MAX_UPLOAD_BYTES.
export const COMPRESSION_LADDER: { quality: number; maxLongEdge: number }[] = [
  { quality: SCAN_JPEG_QUALITY, maxLongEdge: SCAN_MAX_LONG_EDGE },
  { quality: 0.7, maxLongEdge: 2000 },
  { quality: 0.6, maxLongEdge: 1700 },
  { quality: 0.5, maxLongEdge: 1400 },
];

export type ScannerModule = {
  scanDocument(options: { croppedImageQuality?: number; maxNumDocuments?: number; responseType?: 'imageFilePath' | 'base64' }): Promise<{
    scannedImages?: string[];
    status?: 'success' | 'cancel' | string;
  }>;
};

export type ScanDeps = {
  // null when the native module is not in this binary (old build, Expo
  // Go, web) — never throws.
  loadScanner: () => ScannerModule | null;
  // Re-encode as JPEG at `quality`, long edge at most `maxLongEdge`.
  normalizeImage: (uri: string, opts: { quality: number; maxLongEdge: number }) => Promise<{ uri: string; width: number; height: number }>;
  readBytes: (uri: string) => Promise<Uint8Array>;
  writeTempFile: (name: string, bytes: Uint8Array) => string;
  fileSize: (uri: string) => number;
  deleteFile: (uri: string) => void;
  now: () => number;
};

export type ScanUnavailableReason = 'unsupported' | 'denied' | 'failed';

export type ScannedPage = { uri: string; width: number; height: number };

export type ScanOutcome =
  | { status: 'scanned'; pages: ScannedPage[]; originals: string[]; droppedPages: number }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: ScanUnavailableReason; message?: string };

export type PreparedScan =
  | { kind: 'image'; uri: string; mediaType: 'image/jpeg'; name: string; pageCount: 1; temp: string[] }
  | { kind: 'pdf'; uri: string; mediaType: 'application/pdf'; name: string; pageCount: number; temp: string[] }
  | { kind: 'tooLarge'; temp: string[] };

export function classifyScanError(err: unknown): ScanUnavailableReason {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (/permission|denied|not authori[sz]ed/.test(msg)) return 'denied';
  if (/not (available|supported)|unsupported|play services|google play|module|turbomodule|could not be found|null is not an object/.test(msg)) return 'unsupported';
  return 'failed';
}

const safeDelete = (deps: ScanDeps, uri: string) => {
  try {
    deps.deleteFile(uri);
  } catch {
    // already gone
  }
};

export async function runScan(deps: ScanDeps, maxPages: number = MAX_SCAN_PAGES): Promise<ScanOutcome> {
  const scanner = deps.loadScanner();
  if (!scanner) return { status: 'unavailable', reason: 'unsupported' };
  let res: Awaited<ReturnType<ScannerModule['scanDocument']>>;
  try {
    res = await scanner.scanDocument({ croppedImageQuality: 100, maxNumDocuments: maxPages, responseType: 'imageFilePath' });
  } catch (err) {
    return { status: 'unavailable', reason: classifyScanError(err), message: err instanceof Error ? err.message : undefined };
  }
  const images = (res?.scannedImages ?? []).filter((u) => typeof u === 'string' && u.length > 0);
  if (res?.status === 'cancel' || images.length === 0) {
    images.forEach((u) => safeDelete(deps, u));
    return { status: 'cancelled' };
  }
  const kept = images.slice(0, maxPages);
  const dropped = images.slice(maxPages);
  dropped.forEach((u) => safeDelete(deps, u));
  try {
    const pages: ScannedPage[] = [];
    for (const uri of kept) pages.push(await deps.normalizeImage(uri, COMPRESSION_LADDER[0]));
    return { status: 'scanned', pages, originals: kept, droppedPages: dropped.length };
  } catch (err) {
    kept.forEach((u) => safeDelete(deps, u));
    return { status: 'unavailable', reason: 'failed', message: err instanceof Error ? err.message : undefined };
  }
}

// One PDF page per image, sized like a letter page on its long edge (792 pt)
// so a receipt and a statement print at a sensible size.
export async function buildPdf(pages: { bytes: Uint8Array; width: number; height: number }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const img = await doc.embedJpg(p.bytes);
    const scale = 792 / Math.max(p.width, p.height);
    const w = p.width * scale;
    const h = p.height * scale;
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}

// Turns scanned pages into the one file the import/attachment takes: one
// page -> the JPEG itself, 2+ pages -> one PDF. Compresses down the ladder
// until it fits MAX_UPLOAD_BYTES; returns tooLarge (never a silent cut)
// if even the last step does not fit. `temp` lists every file this made
// or was given, for discardScan().
export async function prepareScan(scan: { pages: ScannedPage[]; originals: string[] }, deps: ScanDeps, baseName = 'scan'): Promise<PreparedScan> {
  const temp = [...scan.originals, ...scan.pages.map((p) => p.uri)];
  const stamp = deps.now();
  let pages = scan.pages;
  for (let step = 0; step < COMPRESSION_LADDER.length; step++) {
    if (step > 0) {
      const ladder = COMPRESSION_LADDER[step];
      const next: ScannedPage[] = [];
      for (const uri of scan.originals) next.push(await deps.normalizeImage(uri, ladder));
      temp.push(...next.map((p) => p.uri));
      pages = next;
    }
    if (pages.length === 1) {
      const p = pages[0];
      if (deps.fileSize(p.uri) <= MAX_UPLOAD_BYTES) {
        return { kind: 'image', uri: p.uri, mediaType: 'image/jpeg', name: `${baseName}-${stamp}.jpg`, pageCount: 1, temp };
      }
      continue;
    }
    const withBytes = [];
    for (const p of pages) withBytes.push({ bytes: await deps.readBytes(p.uri), width: p.width, height: p.height });
    const pdf = await buildPdf(withBytes);
    const name = `${baseName}-${stamp}${step > 0 ? `-c${step}` : ''}.pdf`;
    const uri = deps.writeTempFile(name, pdf);
    temp.push(uri);
    if (pdf.byteLength <= MAX_UPLOAD_BYTES) {
      return { kind: 'pdf', uri, mediaType: 'application/pdf', name, pageCount: pages.length, temp };
    }
  }
  return { kind: 'tooLarge', temp };
}

export function discardScan(temp: string[], deps: ScanDeps): void {
  for (const uri of new Set(temp)) safeDelete(deps, uri);
}
