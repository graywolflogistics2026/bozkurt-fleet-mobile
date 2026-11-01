import { File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ScanDeps, ScannerModule } from '@/src/scan/scanCore';

// Real device deps for src/scan/scanCore.ts (batch E).

// The scanner is a TurboModule whose module file calls
// TurboModuleRegistry.getEnforcing() at import time — on a binary built
// before batch E (or Expo Go) that THROWS. So it is required lazily, inside
// try/catch, and a missing module means "unsupported" -> fallback camera.
function loadScanner(): ScannerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-document-scanner-plugin') as { default?: ScannerModule };
    return mod?.default && typeof mod.default.scanDocument === 'function' ? mod.default : null;
  } catch {
    return null;
  }
}

// Settings > Diagnostics (statement reading plan step A): is the native
// scanner module in this build? Same lazy, never-throwing check.
export function scannerModulePresent(): boolean {
  return loadScanner() !== null;
}

async function normalizeImage(uri: string, opts: { quality: number; maxLongEdge: number }) {
  const first = await manipulateAsync(uri, [], { compress: opts.quality, format: SaveFormat.JPEG });
  const long = Math.max(first.width, first.height);
  if (long <= opts.maxLongEdge) return { uri: first.uri, width: first.width, height: first.height };
  const resize = first.width >= first.height ? { width: opts.maxLongEdge } : { height: opts.maxLongEdge };
  const out = await manipulateAsync(uri, [{ resize }], { compress: opts.quality, format: SaveFormat.JPEG });
  try {
    new File(first.uri).delete();
  } catch {
    // ignore
  }
  return { uri: out.uri, width: out.width, height: out.height };
}

export const deviceScanDeps: ScanDeps = {
  loadScanner,
  normalizeImage,
  readBytes: (uri) => new File(uri).bytes(),
  writeTempFile: (name, bytes) => {
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.write(bytes);
    return f.uri;
  },
  fileSize: (uri) => new File(uri).size ?? 0,
  deleteFile: (uri) => {
    const f = new File(uri);
    if (f.exists) f.delete();
  },
  now: () => Date.now(),
};
