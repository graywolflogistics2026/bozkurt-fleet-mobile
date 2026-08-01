import { useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import type { ShareDestination } from '@/src/components/shareCard/shareDestinations';

type ShareTarget = ShareDestination & { label: string };

export type ShareMessages = {
  notAvailableTitle: string;
  imageCopiedTitle: string;
  imageCopiedBody: (app: string, caption: string) => string;
  copiedTitle: string;
  copiedBody: string;
  shareFailedTitle: string;
  tryAgain: string;
};

// UX MEGA-PASS item F: extracted from app/(tabs)/more/share-profit.tsx's
// original handleShareTo()/shareViaSystemSheet() so the AI Coach briefing
// and Scorecard screens can reuse the exact same capture/share pipeline
// ("same share-card pipeline, appropriate content" per the directive)
// instead of duplicating this logic per screen. `caption` and `messages`
// (pre-translated strings) are passed in at call time rather than closed
// over, so this hook carries zero screen-specific content or i18n
// dependency of its own.
export function useShareCapture() {
  const shotRef = useRef<ViewShot>(null);
  const [sharing, setSharing] = useState(false);

  async function shareViaSystemSheet(uri: string, messages: ShareMessages) {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert(messages.notAvailableTitle);
      return;
    }
    await Sharing.shareAsync(uri);
  }

  async function shareTo(dest: ShareTarget, caption: string, messages: ShareMessages) {
    if (!shotRef.current?.capture || sharing) return;
    setSharing(true);
    try {
      const uri = await shotRef.current.capture();

      // 'copy' (Copy Image — see shareDestinations.ts's own note on why
      // there's no literal "link" to copy in this app): pure clipboard
      // action, never opens an app.
      if (dest.key === 'copy') {
        const base64 = await new File(uri).base64();
        await Clipboard.setImageAsync(base64);
        await Clipboard.setStringAsync(caption);
        Alert.alert(messages.copiedTitle, messages.copiedBody);
        return;
      }

      if (dest.scheme) {
        let installed = false;
        try {
          installed = await Linking.canOpenURL(dest.scheme);
        } catch {
          installed = false;
        }
        if (installed) {
          try {
            const base64 = await new File(uri).base64();
            // The OS clipboard can only hold one thing at a time, and the
            // IMAGE has to win here — that's what these apps' "paste from
            // clipboard" composers actually read. The caption is echoed
            // in the alert below so it's still visible to copy/retype.
            await Clipboard.setStringAsync(caption);
            await Clipboard.setImageAsync(base64);
            await Linking.openURL(dest.scheme);
            Alert.alert(messages.imageCopiedTitle, messages.imageCopiedBody(dest.label, caption));
            return;
          } catch {
            // Best-effort only — fall through to the system share sheet.
          }
        }
      }

      // No scheme match / app not installed / "More" — the system share
      // sheet carries the image as a real file attachment, so the
      // clipboard is free for the caption text.
      await Clipboard.setStringAsync(caption);
      await shareViaSystemSheet(uri, messages);
    } catch (err) {
      Alert.alert(messages.shareFailedTitle, err instanceof Error ? err.message : messages.tryAgain);
    } finally {
      setSharing(false);
    }
  }

  return { shotRef, sharing, shareTo };
}
