import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MutedText } from '@/src/components/ui';
import { TruckOwnershipPicker } from '@/src/components/TruckOwnershipPicker';
import { colors, spacing } from '@/src/theme';
import { REVIEW_CLASS_CHOICES, type ReviewLineQuestion } from '@/src/import/settlementLineClass';
import type { ResolvedClass, TruckOwnership } from '@/src/import/lineClass';
import { NeedsDatabaseUpdateError } from '@/src/data/lineClassAnswers';

// The import review card's one-time questions (owner decisions D10/D11,
// docs/decisions/prime-code-classes.md). Answering is optional: an
// unanswered line saves exactly as before (no class, today's category).
// An answer is stored right away and used by this Save and every later one.
export function LineClassQuestions({
  questions,
  onOwnership,
  onClass,
}: {
  questions: ReviewLineQuestion[];
  onOwnership: (v: TruckOwnership) => Promise<void>;
  onClass: (q: Extract<ReviewLineQuestion, { kind: 'unknown_code' }>, cls: ResolvedClass) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (questions.length === 0) return null;

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert(
        t('lineClass.saveFailedTitle'),
        err instanceof NeedsDatabaseUpdateError ? t('lineClass.needsDb') : err instanceof Error ? err.message : t('common.tryAgain')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('lineClass.title')}</Text>
      {questions.map((q) =>
        q.kind === 'truck_ownership' ? (
          <View key="#truck" style={{ marginBottom: spacing.sm }}>
            <MutedText style={{ marginBottom: spacing.xs }}>{t('lineClass.truckQuestion')}</MutedText>
            <TruckOwnershipPicker value={null} onChange={(v) => v && void run(() => onOwnership(v))} />
          </View>
        ) : (
          <View key={q.keyword} style={{ marginBottom: spacing.sm }}>
            <MutedText style={{ marginBottom: spacing.xs }}>
              {t('lineClass.codeQuestion', { line: [q.code, q.description].filter(Boolean).join(' — ') })}
            </MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {REVIEW_CLASS_CHOICES.map((cls) => (
                <Pressable
                  key={cls}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void run(() => onClass(q, cls))}
                  style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card2 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{t(`lineClass.choice.${cls}`)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )
      )}
      <MutedText style={{ fontSize: 12 }}>{t('lineClass.optionalNote')}</MutedText>
    </View>
  );
}
