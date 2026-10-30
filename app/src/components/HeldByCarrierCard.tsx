import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, MutedText } from '@/src/components/ui';
import { useFormatters } from '@/src/i18n/format';
import { localDay } from '@/src/import/printedDates';
import type { HeldByCarrier } from '@/src/stats/heldByCarrier';
import { heldByCarrierLines } from '@/src/stats/heldByCarrierText';
import { colors, typography } from '@/src/theme';

export function HeldByCarrierCard({ held, label }: { held: HeldByCarrier; label?: string }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const { headline, details } = heldByCarrierLines(held, t, money, (iso) => (iso ? date(localDay(iso)) : ''));
  return (
    <Card>
      <MutedText>{label ?? t('heldByCarrier.label')}</MutedText>
      <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '700' }}>{headline}</Text>
      {details.map((line) => (
        <MutedText key={line}>{line}</MutedText>
      ))}
      <MutedText>{t('heldByCarrier.note')}</MutedText>
    </Card>
  );
}
