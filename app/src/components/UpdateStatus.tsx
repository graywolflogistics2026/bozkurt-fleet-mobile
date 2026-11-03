// UPDATE VISIBILITY FIX (owner decision 2026-11-03). expo-updates checks on
// every cold start (ON_LOAD, kept) and DOWNLOADS a new update in the
// background; it RUNS only on the next launch. Two pieces make that
// visible:
// - UpdateSlots (Settings > Check for Update): the update that is RUNNING
//   and the newest one DOWNLOADED, each with id and date.
// - PendingUpdateBanner (always mounted with the tabs): once an update was
//   downloaded in this session, a line "A new update was downloaded;
//   restart the app to apply" with Restart now.
// Both read expo-updates' own useUpdates() state; nothing is guessed.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Updates from 'expo-updates';
import { MutedText } from '@/src/components/ui';
import { updateSlotText } from '@/src/lib/checkForUpdateFormat';
import { restartToApplyUpdate } from '@/src/lib/checkForUpdate';
import { colors, radii, spacing, typography } from '@/src/theme';

export function UpdateSlots() {
  const { t } = useTranslation();
  const u = Updates.useUpdates();
  const running = updateSlotText(u.currentlyRunning, 'Updates.updateId=null');
  const downloaded = u.downloadedUpdate ? updateSlotText(u.downloadedUpdate, 'downloadedUpdate.updateId=null') : t('settings.updateNoneDownloaded');
  return (
    <View style={{ marginTop: spacing.sm }}>
      <MutedText style={{ fontSize: typography.size.xs }}>{t('settings.updateRunning', { update: running })}</MutedText>
      <MutedText style={{ fontSize: typography.size.xs, marginTop: 2 }}>{t('settings.updateDownloaded', { update: downloaded })}</MutedText>
      {u.isUpdatePending && (
        <Text style={{ color: colors.green, fontSize: typography.size.xs, marginTop: 2, fontWeight: '600' }}>{t('settings.updatePendingLine')}</Text>
      )}
    </View>
  );
}

export function PendingUpdateBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = Updates.useUpdates();
  const [hidden, setHidden] = useState(false);
  if (!isUpdatePending || hidden) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + spacing.xs,
        start: spacing.md,
        end: spacing.md,
        backgroundColor: colors.card2,
        borderColor: colors.green,
        borderWidth: 1,
        borderRadius: radii.sm,
        padding: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.xs, flex: 1 }}>{t('settings.updatePendingLine')}</Text>
      <Pressable onPress={() => void restartToApplyUpdate()} style={{ marginStart: spacing.sm }}>
        <Text style={{ color: colors.green, fontWeight: '700', fontSize: typography.size.xs }}>{t('settings.restartNow')}</Text>
      </Pressable>
      <Pressable onPress={() => setHidden(true)} style={{ marginStart: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: typography.size.xs }}>{t('settings.later')}</Text>
      </Pressable>
    </View>
  );
}
