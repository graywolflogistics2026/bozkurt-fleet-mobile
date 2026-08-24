import { Platform, Share, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';

// REFERRAL PROGRAM — SHARE (owner decision 2026-08-24, item R4). Plain
// TEXT sharing (no screenshot capture) — deliberately NOT built on top of
// src/components/shareCard's useShareCapture/ShareCardModal, which hard-
// require an image capture (ViewShot) for every one of their destinations,
// including WhatsApp/SMS/copy. This is a small, separate, untested-by-
// design I/O wrapper (consistent with this codebase's own "pure logic is
// tested, thin I/O glue isn't" convention) around React Native's own core
// `Share` API and the same `whatsapp://send`/`sms:` URL schemes
// shareDestinations.ts already uses for its own (image-based) share flow.
export async function shareViaSystemSheet(message: string): Promise<void> {
  await Share.share({ message });
}

export async function shareViaWhatsApp(message: string): Promise<boolean> {
  const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) return false;
  await Linking.openURL(url);
  return true;
}

export async function shareViaSms(message: string): Promise<boolean> {
  // iOS uses "&body=", Android uses "?body=" for the sms: scheme.
  const separator = Platform.OS === 'ios' ? '&' : '?';
  const url = `sms:${separator}body=${encodeURIComponent(message)}`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) return false;
  await Linking.openURL(url);
  return true;
}

export async function copyReferralMessage(message: string): Promise<void> {
  await Clipboard.setStringAsync(message);
}
