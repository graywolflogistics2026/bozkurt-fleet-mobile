import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { weekQuietLines } from '@/src/import/settlementGate';
import { MutedText } from '@/src/components/ui';
import { spacing } from '@/src/theme';
import type { Settlement } from '@/src/types/db';

// SIMPLE IMPORT FLOW (owner decision 2026-10-31, batch D2 2.2/2.4): the
// "line items incomplete" notices on Deductions / Fuel / Tolls /
// Maintenance and the page lists on settlement detail are gone. Settlement
// detail keeps two quiet lines (WeekQuietLines).
//
// SETTLEMENT READER (owner answer 2026-11-13): the "read the line details
// again" link is removed; only the note stays. The attachments "Read" link
// went with it: both started a job on the old page-by-page reader, whose
// results the app no longer opens. To read a week again, import its PDF
// again (Certify and add replaces the week).
export function WeekQuietLines({ settlement, parsedJson }: { settlement: Settlement; parsedJson: Record<string, unknown> | null | undefined }) {
  const { t } = useTranslation();
  const lines = weekQuietLines(settlement.statement, parsedJson);
  if (!lines.linesNotSaved && !lines.attachments) return null;
  return (
    <View style={{ marginVertical: spacing.xs, gap: spacing.xs }}>
      {lines.linesNotSaved && <MutedText>{t('importFlow.linesNotSaved')}</MutedText>}
      {lines.attachments && <MutedText>{t('importFlow.attachmentsLine', { saved: lines.attachments.saved, read: lines.attachments.read })}</MutedText>}
    </View>
  );
}
