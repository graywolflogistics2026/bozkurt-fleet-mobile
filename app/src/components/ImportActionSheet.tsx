import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ModalSheet, SheetTitle, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { spacing } from '@/src/theme';

// Center tab two-action sheet (Session 9d item 11): Import stays the
// visually primary action (PrimaryButton, listed first) since it's the
// highest-frequency action (same reasoning that gave it the raised center
// tab button in the first place) — Ask AI is a secondary action opening
// the AI Advisor chat.
export function ImportActionSheet({
  visible,
  onClose,
  onImport,
  onAskAi,
}: {
  visible: boolean;
  onClose: () => void;
  onImport: () => void;
  onAskAi: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet visible={visible} onClose={onClose}>
      <SheetTitle>{t('centerAction.title')}</SheetTitle>
      <PrimaryButton title={t('centerAction.import')} onPress={onImport} />
      <View style={{ height: spacing.sm }} />
      <SecondaryButton title={t('centerAction.askAi')} onPress={onAskAi} />
    </ModalSheet>
  );
}
