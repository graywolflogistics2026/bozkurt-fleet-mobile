import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { useFormatters } from '@/src/i18n/format';
import { localDay, type SettlementDateCheck } from '@/src/import/printedDates';
import { colors, radii, spacing, typography } from '@/src/theme';

// PRINTED DATES (owner decision 2026-10-29, A3): when the date gate fails,
// Save is blocked and the preview asks ONE plain question — "The statement
// prints 26/08/14. I read it as Aug 14, 2026. Correct?" [Yes] [Pick
// another date] — with a picker prefilled with the app's own reading.
export function SettlementDateQuestion({
  check,
  onConfirm,
}: {
  check: SettlementDateCheck;
  onConfirm: (weekEnding: string) => void;
}) {
  const { t } = useTranslation();
  const { date } = useFormatters();
  const [picking, setPicking] = useState(false);
  const reading = check.weekEnding;
  const readingText = reading ? date(localDay(reading), { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const question = !reading
    ? t('importScreen.dateQuestion.noReading')
    : check.printed
      ? t('importScreen.dateQuestion.printed', { printed: check.printed, reading: readingText })
      : t('importScreen.dateQuestion.noPrinted', { reading: readingText });

  return (
    <View
      style={{
        backgroundColor: 'rgba(245,158,11,0.12)',
        borderColor: colors.orange,
        borderWidth: 1,
        borderRadius: radii.sm,
        padding: spacing.sm,
        marginBottom: spacing.sm,
      }}
    >
      <Text style={{ color: colors.text, fontWeight: '700' }}>{question}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        {reading && <PrimaryButton title={t('importScreen.dateQuestion.yes')} onPress={() => onConfirm(reading)} />}
        <SecondaryButton title={t('importScreen.dateQuestion.pick')} onPress={() => setPicking((p) => !p)} />
      </View>
      {picking && <DayPicker initial={reading ?? new Date().toISOString().slice(0, 10)} onPick={onConfirm} />}
    </View>
  );
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : colors.card2,
        marginEnd: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

// Year / month / day pills — no native module, ships with eas update.
export function DayPicker({ initial, onPick }: { initial: string; onPick: (iso: string) => void }) {
  const { t } = useTranslation();
  const { date, monthLabel } = useFormatters();
  const [value, setValue] = useState(initial);
  const [y, m, d] = value.split('-').map(Number);
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear - 2, thisYear - 1, thisYear, thisYear + 1, y])].sort((a, b) => a - b);
  const daysIn = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
  const iso = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(dd, daysIn(yy, mm))).padStart(2, '0')}`;

  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: colors.text, fontSize: typography.size.lg, fontWeight: '700' }}>📅 {date(localDay(value))}</Text>
      <MutedText style={{ fontSize: typography.size.xs }}>{t('importScreen.dateQuestion.year')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {years.map((yy) => (
          <Pill key={yy} label={String(yy)} selected={yy === y} onPress={() => setValue(iso(yy, m, d))} />
        ))}
      </View>
      <MutedText style={{ fontSize: typography.size.xs }}>{t('importScreen.dateQuestion.month')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
          <Pill key={mm} label={monthLabel(y, mm, { month: 'short' })} selected={mm === m} onPress={() => setValue(iso(y, mm, d))} />
        ))}
      </View>
      <MutedText style={{ fontSize: typography.size.xs }}>{t('importScreen.dateQuestion.day')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: daysIn(y, m) }, (_, i) => i + 1).map((dd) => (
          <Pill key={dd} label={String(dd)} selected={dd === d} onPress={() => setValue(iso(y, m, dd))} />
        ))}
      </View>
      <PrimaryButton title={t('importScreen.dateQuestion.useThis')} onPress={() => onPick(value)} />
    </View>
  );
}
