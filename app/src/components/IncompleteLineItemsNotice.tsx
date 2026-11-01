import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useReadDocumentPages } from '@/src/data/importJobs';
import { useUserCategories } from '@/src/data/userCategories';
import { useCategoryLearningRules } from '@/src/data/categoryLearningRules';
import { useCarrierCodeMaps } from '@/src/data/carrierCodeMaps';
import { weekQuietLines } from '@/src/import/settlementGate';
import { MutedText } from '@/src/components/ui';
import { colors, spacing } from '@/src/theme';
import type { Settlement } from '@/src/types/db';

// SIMPLE IMPORT FLOW (owner decision 2026-10-31, batch D2 2.2/2.4): the
// "line items incomplete" notices on Deductions / Fuel / Tolls /
// Maintenance and the page lists on settlement detail are gone. Settlement
// detail keeps two quiet lines (WeekQuietLines). Reading pages again starts
// a background job; its result comes back as the same CHECK AND CERTIFY
// card (Certify and add replaces the week).

// Starts a job that reads `pages` of the week's stored PDF.
export function useReadWeekPages() {
  const { t, i18n } = useTranslation();
  const readPages = useReadDocumentPages();
  const { data: userCategories } = useUserCategories({ active: true });
  const { data: learningRulesData } = useCategoryLearningRules();
  const { data: carrierCodeMaps } = useCarrierCodeMaps();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function start(settlement: Pick<Settlement, 'id' | 'document_id'>, pages: number[], key: string) {
    if (!settlement.document_id || pages.length === 0) return;
    setBusyKey(key);
    try {
      await readPages.mutateAsync({
        documentId: settlement.document_id,
        pages,
        locale: i18n.language,
        customCategories: (userCategories ?? []).map((c) => c.name),
        learningRules: (learningRulesData ?? []).map((r) => ({ keyword: r.keyword, category: r.category })),
        carrierCodeMaps: carrierCodeMaps ?? undefined,
      });
      Alert.alert(t('importFlow.readAgainStartedTitle'), t('importFlow.readAgainStartedBody'));
    } catch (err) {
      Alert.alert(t('importFlow.readAgainStartedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setBusyKey(null);
    }
  }

  return { start, busyKey };
}

function QuietLink({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} hitSlop={8} accessibilityRole="button">
      <Text style={{ color: colors.accent, fontWeight: '600', opacity: busy ? 0.5 : 1 }}>{label}</Text>
    </Pressable>
  );
}

export function WeekQuietLines({ settlement, parsedJson }: { settlement: Settlement; parsedJson: Record<string, unknown> | null | undefined }) {
  const { t } = useTranslation();
  const { start, busyKey } = useReadWeekPages();
  const lines = weekQuietLines(settlement.statement, parsedJson);
  if (!lines.linesNotSaved && !lines.attachments) return null;
  return (
    <View style={{ marginVertical: spacing.xs, gap: spacing.xs }}>
      {lines.linesNotSaved && (
        <View>
          <MutedText>{t('importFlow.linesNotSaved')}</MutedText>
          {settlement.document_id && lines.contentPages.length > 0 && (
            <QuietLink label={t('importFlow.tryReadingAgain')} onPress={() => start(settlement, lines.contentPages, 'lines')} busy={busyKey === 'lines'} />
          )}
        </View>
      )}
      {lines.attachments && (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <MutedText>{t('importFlow.attachmentsLine', { saved: lines.attachments.saved, read: lines.attachments.read })}</MutedText>
          {settlement.document_id && lines.attachments.unreadPages.length > 0 && (
            <QuietLink label={t('importFlow.read')} onPress={() => start(settlement, lines.attachments!.unreadPages, 'attachments')} busy={busyKey === 'attachments'} />
          )}
        </View>
      )}
    </View>
  );
}
