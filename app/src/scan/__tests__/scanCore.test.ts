import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import {
  classifyScanError,
  COMPRESSION_LADDER,
  discardScan,
  MAX_SCAN_PAGES,
  MAX_UPLOAD_BYTES,
  prepareScan,
  runScan,
  SCAN_JPEG_QUALITY,
  SCAN_MAX_LONG_EDGE,
  type ScanDeps,
  type ScannerModule,
} from '@/src/scan/scanCore';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/src/scan/scanDeps', () => ({ deviceScanDeps: {} }));
// eslint-disable-next-line import/first
import { captureDocument, type CapturedDocument } from '@/src/scan/scanDocument';

// AUTOMATIC DOCUMENT SCANNER (batch E) with the native module mocked:
// success, cancel, permission denied, unsupported (fallback), multi-page to
// ONE PDF, the 10-page cap, oversize compression, temp-file cleanup.

// A minimal JPEG header pdf-lib can embed (SOI, SOF0 with the size, EOI),
// padded with `pad` bytes so a test can make a page as big as it needs.
function fakeJpeg(width: number, height: number, pad = 0): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const bytes = new Uint8Array(2 + sof.length + pad + 2);
  bytes.set([0xff, 0xd8], 0);
  bytes.set(sof, 2);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

function makeDeps(over: Partial<ScanDeps> & { images?: string[]; status?: string; scanError?: Error; sizes?: Record<string, number>; pad?: (uri: string) => number } = {}) {
  const deleted: string[] = [];
  const written: Record<string, Uint8Array> = {};
  const normalizeCalls: { uri: string; quality: number; maxLongEdge: number }[] = [];
  const scanner: ScannerModule = {
    scanDocument: jest.fn(async () => {
      if (over.scanError) throw over.scanError;
      return { scannedImages: over.images ?? ['raw-1.jpg'], status: over.status ?? 'success' };
    }),
  };
  const deps: ScanDeps = {
    loadScanner: () => scanner,
    normalizeImage: async (uri, opts) => {
      normalizeCalls.push({ uri, ...opts });
      return { uri: `${uri}@q${opts.quality}`, width: 1700, height: opts.maxLongEdge };
    },
    readBytes: async (uri) => fakeJpeg(1700, 2200, over.pad?.(uri) ?? 0),
    writeTempFile: (name, bytes) => {
      written[name] = bytes;
      return `cache/${name}`;
    },
    fileSize: (uri) => over.sizes?.[uri] ?? 500_000,
    deleteFile: (uri) => {
      deleted.push(uri);
    },
    now: () => 1700000000000,
    ...over,
  };
  return { deps, scanner, deleted, written, normalizeCalls };
}

describe('runScan', () => {
  it('success: asks for up to 10 pages, JPEG 85%, long edge <= 2,200 px', async () => {
    const { deps, scanner, normalizeCalls } = makeDeps({ images: ['a.jpg'] });
    const out = await runScan(deps);
    expect(scanner.scanDocument).toHaveBeenCalledWith({ croppedImageQuality: 100, maxNumDocuments: MAX_SCAN_PAGES, responseType: 'imageFilePath' });
    expect(out).toMatchObject({ status: 'scanned', droppedPages: 0, originals: ['a.jpg'] });
    expect(normalizeCalls).toEqual([{ uri: 'a.jpg', quality: SCAN_JPEG_QUALITY, maxLongEdge: SCAN_MAX_LONG_EDGE }]);
    expect([SCAN_JPEG_QUALITY, SCAN_MAX_LONG_EDGE]).toEqual([0.85, 2200]);
  });

  it('cancel: nothing comes back, any returned file is deleted', async () => {
    const { deps, deleted } = makeDeps({ images: ['x.jpg'], status: 'cancel' });
    expect(await runScan(deps)).toEqual({ status: 'cancelled' });
    expect(deleted).toEqual(['x.jpg']);
    expect(await runScan(makeDeps({ images: [] }).deps)).toEqual({ status: 'cancelled' });
  });

  it('permission denied -> unavailable/denied', async () => {
    const { deps } = makeDeps({ scanError: new Error('Camera permission denied') });
    expect(await runScan(deps)).toMatchObject({ status: 'unavailable', reason: 'denied' });
  });

  it('unsupported: module missing from this binary, or no Google Play services', async () => {
    expect(await runScan({ ...makeDeps().deps, loadScanner: () => null })).toEqual({ status: 'unavailable', reason: 'unsupported' });
    expect(classifyScanError(new Error('Google Play services not available'))).toBe('unsupported');
    expect(classifyScanError(new Error('boom'))).toBe('failed');
  });

  it('caps at 10 pages on every platform (iOS has no cap option) and deletes the rest', async () => {
    const images = Array.from({ length: 12 }, (_, i) => `p${i + 1}.jpg`);
    const { deps, deleted } = makeDeps({ images });
    const out = await runScan(deps);
    if (out.status !== 'scanned') throw new Error(out.status);
    expect(out.pages).toHaveLength(10);
    expect(out.droppedPages).toBe(2);
    expect(deleted).toEqual(['p11.jpg', 'p12.jpg']);
  });
});

describe('prepareScan', () => {
  it('one page -> the JPEG itself', async () => {
    const { deps } = makeDeps({ images: ['a.jpg'] });
    const scan = await runScan(deps);
    if (scan.status !== 'scanned') throw new Error();
    const out = await prepareScan(scan, deps, 'receipt');
    expect(out).toMatchObject({ kind: 'image', mediaType: 'image/jpeg', pageCount: 1, uri: 'a.jpg@q0.85', name: 'receipt-1700000000000.jpg' });
  });

  it('multi-page -> ONE PDF built on the device, one page per scan, in order', async () => {
    const { deps, written } = makeDeps({ images: ['a.jpg', 'b.jpg', 'c.jpg'] });
    const scan = await runScan(deps);
    if (scan.status !== 'scanned') throw new Error();
    const out = await prepareScan(scan, deps, 'import');
    expect(out).toMatchObject({ kind: 'pdf', mediaType: 'application/pdf', pageCount: 3, uri: 'cache/import-1700000000000.pdf' });
    const pdf = await PDFDocument.load(written['import-1700000000000.pdf']);
    expect(pdf.getPageCount()).toBe(3);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(height)).toBe(792);
    expect(width).toBeCloseTo(1700 * (792 / 2200), 3);
  });

  it('oversize single page -> recompressed down the ladder until it fits 10 MB', async () => {
    const { deps, normalizeCalls } = makeDeps({ images: ['a.jpg'], sizes: { 'a.jpg@q0.85': 12_000_000, 'a.jpg@q0.7': 11_000_000 } });
    const scan = await runScan(deps);
    if (scan.status !== 'scanned') throw new Error();
    const out = await prepareScan(scan, deps);
    expect(out).toMatchObject({ kind: 'image', uri: 'a.jpg@q0.6' });
    expect(normalizeCalls.map((c) => c.quality)).toEqual([0.85, 0.7, 0.6]);
  });

  it('oversize multi-page PDF -> rebuilt smaller; still over at the last step -> tooLarge, never a silent cut', async () => {
    const big = (uri: string) => (uri.includes('@q0.85') ? 6 * 1024 * 1024 : 1000);
    const { deps } = makeDeps({ images: ['a.jpg', 'b.jpg'], pad: big });
    const scan = await runScan(deps);
    if (scan.status !== 'scanned') throw new Error();
    const out = await prepareScan(scan, deps);
    expect(out).toMatchObject({ kind: 'pdf', pageCount: 2, name: 'scan-1700000000000-c1.pdf' });

    const always = makeDeps({ images: ['a.jpg', 'b.jpg'], pad: () => 6 * 1024 * 1024 });
    const scan2 = await runScan(always.deps);
    if (scan2.status !== 'scanned') throw new Error();
    const tooBig = await prepareScan(scan2, always.deps);
    expect(tooBig.kind).toBe('tooLarge');
    expect(tooBig.temp.length).toBeGreaterThan(2);
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    expect(COMPRESSION_LADDER[0]).toEqual({ quality: 0.85, maxLongEdge: 2200 });
  });

  it('discardScan deletes every temp file once', () => {
    const { deps, deleted } = makeDeps();
    discardScan(['a', 'b', 'a'], deps);
    expect(deleted).toEqual(['a', 'b']);
  });
});

describe('captureDocument (the shared helper every screen calls)', () => {
  const photo: CapturedDocument = { uri: 'cam.jpg', mediaType: 'image/jpeg', name: 'cam.jpg', pageCount: 1, source: 'camera', droppedPages: 0, cleanup: () => {} };

  it('success: the scan, and cleanup deletes its temp files', async () => {
    const { deps, deleted } = makeDeps({ images: ['a.jpg', 'b.jpg'] });
    const r = await captureDocument({ deps, takePhoto: async () => photo });
    if (r.status !== 'ready') throw new Error(r.status);
    expect(r.doc).toMatchObject({ source: 'scanner', mediaType: 'application/pdf', pageCount: 2 });
    r.doc.cleanup();
    expect(deleted).toEqual(expect.arrayContaining(['a.jpg', 'b.jpg', 'a.jpg@q0.85', 'b.jpg@q0.85', 'cache/scan-1700000000000.pdf']));
  });

  it('cancel: no camera pops up behind it', async () => {
    const takePhoto = jest.fn(async () => photo);
    const r = await captureDocument({ deps: makeDeps({ status: 'cancel' }).deps, takePhoto });
    expect(r).toEqual({ status: 'cancelled' });
    expect(takePhoto).not.toHaveBeenCalled();
  });

  it('denied / unsupported / failed -> falls back to the plain camera', async () => {
    for (const deps of [
      makeDeps({ scanError: new Error('permission denied') }).deps,
      { ...makeDeps().deps, loadScanner: () => null },
      makeDeps({ scanError: new Error('boom') }).deps,
    ]) {
      const r = await captureDocument({ deps, takePhoto: async () => photo });
      expect(r).toEqual({ status: 'ready', doc: photo });
    }
  });

  it("fallback 'none' hands control back (Import keeps its own camera screen)", async () => {
    const r = await captureDocument({ deps: { ...makeDeps().deps, loadScanner: () => null }, fallback: 'none' });
    expect(r).toEqual({ status: 'unavailable', reason: 'unsupported' });
  });

  it('tooLarge deletes everything it made', async () => {
    const m = makeDeps({ images: ['a.jpg'], sizes: Object.fromEntries(COMPRESSION_LADDER.map((l) => [`a.jpg@q${l.quality}`, 20_000_000])) });
    const r = await captureDocument({ deps: m.deps, takePhoto: async () => photo });
    expect(r).toEqual({ status: 'tooLarge' });
    expect(m.deleted).toEqual(expect.arrayContaining(['a.jpg', 'a.jpg@q0.85', 'a.jpg@q0.5']));
  });
});

describe('wiring (source checks)', () => {
  const APP = path.resolve(__dirname, '../../..');
  const read = (rel: string) => fs.readFileSync(path.join(APP, rel), 'utf8');

  it('every screen that took a photo now calls captureDocument(); plain photo, gallery and PDF stay', () => {
    for (const f of ['app/(tabs)/deductions.tsx', 'app/(tabs)/more/prime-driver-expenses.tsx', 'app/(tabs)/import/index.tsx']) {
      const src = read(f);
      expect(src).toContain('captureDocument(');
      expect(src).toContain("t('scan.plainPhoto')");
      expect(src).toContain('launchImageLibraryAsync');
      expect(src).toContain('getDocumentAsync');
      expect(src).not.toContain('launchCameraAsync');
    }
  });

  it('the native module is only ever required lazily (an old binary must not crash)', () => {
    expect(read('src/scan/scanDeps.ts')).toMatch(/try \{\s*\/\/[^\n]*\n\s*const mod = require\('react-native-document-scanner-plugin'\)/);
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(APP, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(rel);
        return /\.(ts|tsx)$/.test(e.name) && /from 'react-native-document-scanner-plugin'/.test(read(rel)) ? [rel] : [];
      });
    const offenders = ['src', 'app'].flatMap((d) => walk(d));
    expect(offenders).toEqual([]);
  });

  it('config: scanner plugin, camera text, version bumped past 1.0.0 (appVersion runtime)', () => {
    const cfg = read('app.config.js');
    expect(cfg).toContain("'react-native-document-scanner-plugin'");
    expect(cfg).toContain('We use the camera to scan your receipts and statements.');
    expect(cfg).not.toMatch(/version: '1\.0\.0'/);
    expect(cfg).toMatch(/policy: 'appVersion'/);
  });
});
