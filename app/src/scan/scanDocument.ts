import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { discardScan, MAX_SCAN_PAGES, prepareScan, runScan, type ScanDeps, type ScanUnavailableReason } from '@/src/scan/scanCore';
import { deviceScanDeps } from '@/src/scan/scanDeps';

// ONE shared entry point for "take a photo of a document" (batch E). Every
// screen that used to open the plain camera calls captureDocument():
// Import "Take photo", the Deductions receipt, For Prime Inc Drivers. It
// opens the automatic scanner (edges detected, page flattened and cropped
// on the device) and falls back to the plain camera when the scanner is
// unsupported (old build, no Google Play services), denied or fails. A
// cancel is just a cancel — no camera pops up behind it. "Plain photo",
// "From gallery" and "PDF" stay as their own buttons on every screen.

export type CapturedDocument = {
  uri: string;
  mediaType: 'image/jpeg' | 'application/pdf';
  name: string;
  pageCount: number;
  source: 'scanner' | 'camera';
  // Pages past MAX_SCAN_PAGES that were dropped (and deleted).
  droppedPages: number;
  // Deletes every temp file of this capture. Call after the upload
  // finished (or failed) and when the user cancels.
  cleanup: () => void;
};

export type CaptureResult =
  | { status: 'ready'; doc: CapturedDocument }
  | { status: 'cancelled' }
  | { status: 'tooLarge' }
  // The scanner could not run and the caller asked for no fallback.
  | { status: 'unavailable'; reason: ScanUnavailableReason };

export type CaptureOptions = {
  // 'plainCamera' (default) opens expo-image-picker's camera when the
  // scanner cannot run; 'none' returns 'unavailable' so the caller can use
  // its own camera screen (Import keeps its CameraView route).
  fallback?: 'plainCamera' | 'none';
  baseName?: string;
  deps?: ScanDeps;
  takePhoto?: () => Promise<CapturedDocument | null>;
};

// Plain camera photo (the pre-batch-E behavior), also the "Plain photo"
// button. Not a temp file this app owns, so cleanup does nothing.
export async function takePlainPhoto(): Promise<CapturedDocument | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const a = picked.assets[0];
  return {
    uri: a.uri,
    mediaType: 'image/jpeg',
    name: a.fileName || `photo-${Date.now()}.jpg`,
    pageCount: 1,
    source: 'camera',
    droppedPages: 0,
    cleanup: () => {},
  };
}

export async function captureDocument(options: CaptureOptions = {}): Promise<CaptureResult> {
  const deps = options.deps ?? deviceScanDeps;
  const takePhoto = options.takePhoto ?? takePlainPhoto;
  const scan = await runScan(deps);
  if (scan.status === 'cancelled') return { status: 'cancelled' };
  if (scan.status === 'unavailable') {
    if ((options.fallback ?? 'plainCamera') === 'none') return { status: 'unavailable', reason: scan.reason };
    const photo = await takePhoto();
    return photo ? { status: 'ready', doc: photo } : { status: 'cancelled' };
  }
  let prepared;
  try {
    prepared = await prepareScan(scan, deps, options.baseName ?? 'scan');
  } catch {
    discardScan([...scan.originals, ...scan.pages.map((p) => p.uri)], deps);
    if ((options.fallback ?? 'plainCamera') === 'none') return { status: 'unavailable', reason: 'failed' };
    const photo = await takePhoto();
    return photo ? { status: 'ready', doc: photo } : { status: 'cancelled' };
  }
  if (prepared.kind === 'tooLarge') {
    discardScan(prepared.temp, deps);
    return { status: 'tooLarge' };
  }
  const temp = prepared.temp;
  return {
    status: 'ready',
    doc: {
      uri: prepared.uri,
      mediaType: prepared.mediaType,
      name: prepared.name,
      pageCount: prepared.pageCount,
      source: 'scanner',
      droppedPages: scan.droppedPages,
      cleanup: () => discardScan(temp, deps),
    },
  };
}

type T = (key: string, options?: Record<string, unknown>) => string;

// The two things a screen must tell the user after a capture: the file was
// too big even after compressing, or pages past the page cap were left out.
export function explainCapture(result: CaptureResult, t: T): void {
  if (result.status === 'tooLarge') Alert.alert(t('scan.tooLargeTitle'), t('scan.tooLargeBody'));
  else if (result.status === 'ready' && result.doc.droppedPages > 0) {
    Alert.alert(t('scan.pagesDroppedTitle'), t('scan.pagesDroppedBody', { max: MAX_SCAN_PAGES, count: result.doc.droppedPages }));
  }
}
