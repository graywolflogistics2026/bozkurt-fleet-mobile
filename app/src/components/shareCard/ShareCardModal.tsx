import type { ReactNode } from 'react';
import { View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { useTranslation } from 'react-i18next';
import { useShareCapture } from '@/src/components/shareCard/useShareCapture';
import { useShareMessages } from '@/src/components/shareCard/useShareMessages';
import { ShareDestinationsRow } from '@/src/components/shareCard/ShareDestinationsRow';
import { ModalSheet, SheetTitle, MutedText } from '@/src/components/ui';
import { spacing } from '@/src/theme';

// UX MEGA-PASS item F (owner decision 2026-07-31): "same share-card
// pipeline, appropriate content" for the AI Coach briefing and Scorecard
// screens — this is the one reusable modal wrapper (ModalSheet, so it
// gets item B's close X/scroll/keyboard-avoidance for free) around the
// capture+destinations pipeline share-profit.tsx also uses. Each caller
// supplies only its own card content (`renderCard`) and caption; capture,
// clipboard, and share-sheet logic live once in useShareCapture().
export function ShareCardModal({
  visible,
  onClose,
  title,
  caption,
  renderCard,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  caption: string;
  renderCard: () => ReactNode;
}) {
  const { t } = useTranslation();
  const { shotRef, sharing, shareTo } = useShareCapture();
  const messages = useShareMessages();

  return (
    <ModalSheet visible={visible} onClose={onClose}>
      <SheetTitle>{title}</SheetTitle>
      <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
        <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
          {renderCard()}
        </ViewShot>
      </View>
      <MutedText style={{ marginBottom: spacing.xs }}>{t('shareProfit.shareTo')}</MutedText>
      <ShareDestinationsRow disabled={sharing} onShare={(dest) => shareTo(dest, caption, messages)} />
    </ModalSheet>
  );
}
