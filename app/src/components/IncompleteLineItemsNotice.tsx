import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useReadDocumentPages } from '@/src/data/importJobs';
import { useUserCategories } from '@/src/data/userCategories';
import { useCategoryLearningRules } from '@/src/data/categoryLearningRules';
import { useCarrierCodeMaps } from '@/src/data/carrierCodeMaps';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { truckIdFilterFor } from '@/src/stats/fleetScope';
import { lineItemsIncomplete } from '@/src/import/settlementStatement';
import { formatPageList } from '@/src/import/importJobs';
import { useFormatters } from '@/src/i18n/format';
import { MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { Settlement } from '@/src/types/db';

// RESUMABLE IMPORT JOBS (owner decision 2026-10-13, decision G): when a
// week's settlement or statement pages could not be read, its line items
// (deductions, fuel, tolls, maintenance) are incomplete — profit still
// comes from the statement when it passed its checks. The Deductions,
// Fuel, Tolls and Maintenance screens say so, and "Read the missing pages"
// reads ONLY those pages of the stored PDF; the result is reviewed and
// saved like any import (Save replaces the week).

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
      Alert.alert(t('incompleteWeek.startedTitle'), t('incompleteWeek.startedBody', { pages: formatPageList(pages) }));
    } catch (err) {
      Alert.alert(t('incompleteWeek.failedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setBusyKey(null);
    }
  }

  return { start, busyKey };
}

export function IncompleteLineItemsNotice() {
  const { t } = useTranslation();
  const { date } = useFormatters();
  const { activeTruckId } = useActiveTruck();
  const settlementsQuery = useSettlements({ truck_id: truckIdFilterFor(activeTruckId) });
  const { start, busyKey } = useReadWeekPages();
  const weeks = (settlementsQuery.data ?? [])
    .filter((s) => lineItemsIncomplete(s.statement) && !!s.document_id)
    .sort((a, b) => b.week_ending.localeCompare(a.week_ending))
    .slice(0, 3);
  if (weeks.length === 0) return null;

  return (
    <View style={{ borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm, backgroundColor: 'rgba(245,158,11,0.10)' }}>
      <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>{t('incompleteWeek.title')}</Text>
      {weeks.map((s) => {
        const pages = (s.statement?.pages?.incomplete ?? []).map((p) => p.page);
        return (
          <View key={s.id} style={{ marginBottom: spacing.xs }}>
            <MutedText>{t('incompleteWeek.weekLine', { date: date(s.week_ending), pages: formatPageList(pages) })}</MutedText>
            <SecondaryButton title={t('incompleteWeek.readMissing')} onPress={() => start(s, pages, s.id)} loading={busyKey === s.id} />
          </View>
        );
      })}
    </View>
  );
}

// Settlement detail: the week's missing pages ("Read the missing pages")
// and the pages kept in the file without being read ("Read this page").
const UNREAD_SHOWN = 12;

export function WeekPagesSection({ settlement }: { settlement: Settlement }) {
  const { t } = useTranslation();
  const { start, busyKey } = useReadWeekPages();
  const pages = settlement.statement?.pages;
  if (!pages || !settlement.document_id) return null;
  const incomplete = pages.incomplete.map((p) => p.page);
  const unread = pages.unread;
  if (incomplete.length === 0 && unread.length === 0) return null;

  return (
    <View style={{ borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginVertical: spacing.sm }}>
      {incomplete.length > 0 && (
        <View style={{ marginBottom: spacing.sm }}>
          <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('incompleteWeek.detailTitle')}</Text>
          <MutedText>{t('incompleteWeek.detailBody', { pages: formatPageList(incomplete), total: pages.total })}</MutedText>
          <SecondaryButton title={t('incompleteWeek.readMissing')} onPress={() => start(settlement, incomplete, 'missing')} loading={busyKey === 'missing'} />
        </View>
      )}
      {unread.length > 0 && (
        <View>
          <MutedText style={{ marginBottom: spacing.xs }}>
            {t('incompleteWeek.unreadBody', { count: unread.length, pages: formatPageList(unread.map((p) => p.page)) })}
          </MutedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {unread.slice(0, UNREAD_SHOWN).map((p) => (
              <Pressable
                key={p.page}
                disabled={busyKey != null}
                onPress={() => start(settlement, [p.page], `page-${p.page}`)}
                style={({ pressed }) => ({
                  borderColor: colors.accent,
                  borderWidth: 1,
                  borderRadius: radii.sm,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                  opacity: pressed || busyKey === `page-${p.page}` ? 0.6 : 1,
                })}
              >
                <Text style={{ color: colors.accent, fontSize: typography.size.xs, fontWeight: '600' }}>
                  {t('incompleteWeek.readThisPage', { page: p.page })}
                </Text>
              </Pressable>
            ))}
          </View>
          {unread.length > UNREAD_SHOWN && (
            <MutedText style={{ marginTop: spacing.xs }}>{t('incompleteWeek.moreUnread', { count: unread.length - UNREAD_SHOWN })}</MutedText>
          )}
        </View>
      )}
    </View>
  );
}
