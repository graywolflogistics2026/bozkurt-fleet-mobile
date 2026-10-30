import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { NeedsReviewChip } from '@/src/components/NeedsReviewBadge';
import { DayPicker } from '@/src/components/SettlementDateQuestion';
import { useFormatters } from '@/src/i18n/format';
import { localDay, type SavedWeekDateCheck } from '@/src/import/printedDates';
import { colors, spacing } from '@/src/theme';

// "NEEDS A DATE CHECK" (owner decision 2026-10-29, A6): saved weeks that
// break the printed-date rules, each with a one-tap fix to the printed
// date when it is known, else a date picker. Same needs-review chip as
// every other review list.
export function DateCheckList({ items, onFix }: { items: SavedWeekDateCheck[]; onFix: (id: string, weekEnding: string) => void }) {
  const { t } = useTranslation();
  const { date } = useFormatters();
  const [picking, setPicking] = useState<string | null>(null);
  if (items.length === 0) return null;
  const day = (iso: string) => date(localDay(iso));
  return (
    <Card style={{ borderColor: colors.orange, borderWidth: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <NeedsReviewChip />
        <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('dateCheck.title', { count: items.length })}</Text>
      </View>
      {items.map((item) => (
        <View key={item.id} style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.text }}>
            {t('dateCheck.row', { date: day(item.weekEnding), reasons: item.reasons.map((r) => t(`dateCheck.reason.${r}`)).join(', ') })}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
            {item.suggested && <PrimaryButton title={t('dateCheck.fixTo', { date: day(item.suggested) })} onPress={() => onFix(item.id, item.suggested!)} />}
            <SecondaryButton title={t('dateCheck.pick')} onPress={() => setPicking(picking === item.id ? null : item.id)} />
          </View>
          {picking === item.id && (
            <DayPicker
              initial={item.suggested ?? item.weekEnding}
              onPick={(iso) => {
                setPicking(null);
                onFix(item.id, iso);
              }}
            />
          )}
        </View>
      ))}
      <MutedText style={{ marginTop: spacing.sm }}>{t('dateCheck.note')}</MutedText>
    </Card>
  );
}
