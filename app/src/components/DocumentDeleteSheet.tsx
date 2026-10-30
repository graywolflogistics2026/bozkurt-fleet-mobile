import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ModalSheet, SheetTitle, MutedText, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useReimbursements } from '@/src/data/reimbursements';
import { useLoads } from '@/src/data/loads';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useTrucksList } from '@/src/data/trucks';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import {
  deleteDocumentCascade,
  documentDeleteProfitEffect,
  linkedRowCount,
  previewDocumentDelete,
  retryPendingStorageRemovals,
  settlementWeekToConfirm,
  typedConfirmationMatches,
  type DeleteMode,
  type DocumentDeletePreview,
} from '@/src/data/documentDelete';
import { useFormatters } from '@/src/i18n/format';
import { colors, spacing, typography } from '@/src/theme';

// DELETE A DOCUMENT AND EVERYTHING LINKED (owner decision 2026-10-30, batch A
// item 7): counts and dollars by table, the week's profit before/after,
// [Delete file and everything linked] (default), [Delete file only, keep the
// records] (when records are linked), [Cancel]. A settlement document
// deletes the whole settlement and asks for the week ending to be typed.
export function DocumentDeleteSheet({
  documentId,
  onClose,
  onDeleted,
}: {
  documentId: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<DocumentDeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<DeleteMode | null>(null);

  const settlementsQuery = useSettlements();
  const dedQuery = useDeductions();
  const reimbQuery = useReimbursements();
  const loadsQuery = useLoads();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const trucksQuery = useTrucksList();

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setTyped('');
    retryPendingStorageRemovals(AsyncStorage).catch(() => undefined);
    previewDocumentDelete(documentId)
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : t('deductions.genericRetry')));
    return () => {
      cancelled = true;
    };
  }, [documentId, t]);

  const effect = useMemo(() => {
    if (!preview) return null;
    return documentDeleteProfitEffect(preview, 'all', {
      trucks: trucksQuery.data ?? [],
      settlements: settlementsQuery.data ?? [],
      loads: loadsQuery.data ?? [],
      deductions: dedQuery.data ?? [],
      fuelPurchases: fuelQuery.data ?? [],
      maintenanceRecords: maintenanceQuery.data ?? [],
      tolls: tollsQuery.data ?? [],
      reimbursements: reimbQuery.data ?? [],
    });
  }, [preview, trucksQuery.data, settlementsQuery.data, loadsQuery.data, dedQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data, reimbQuery.data]);

  const weekToType = preview ? settlementWeekToConfirm(preview) : null;
  const linked = preview ? linkedRowCount(preview) : 0;
  const canDeleteAll = !!preview && preview.status === 'ok' && typedConfirmationMatches(typed, weekToType);

  async function run(mode: DeleteMode) {
    if (!documentId) return;
    setBusy(mode);
    try {
      const result = await deleteDocumentCascade(documentId, mode, AsyncStorage);
      // Every screen that reads a table this can touch: Home, Scorecard,
      // Profit Analysis, Per-Truck, Deductions, Fuel, Tolls, Maintenance,
      // Equipment, Capital, Tax, Cash Flow, alerts, Prime report, Accountant
      // Package, Settlements, held/deposited, Documents.
      await invalidateFinancialData(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['orphan-summary'] });
      if (result.status === 'not_found') {
        Alert.alert(t('documentDelete.goneTitle'), t('documentDelete.goneBody'));
      } else if (!result.storageRemoved) {
        Alert.alert(t('documentDelete.doneTitle'), t('documentDelete.fileRetryBody'));
      }
      onDeleted();
    } catch (err) {
      Alert.alert(t('documentDelete.failedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setBusy(null);
    }
  }

  const ok = preview?.status === 'ok' ? preview : null;

  return (
    <ModalSheet visible={!!documentId} onClose={() => !busy && onClose()}>
      <SheetTitle>{t('documentDelete.title')}</SheetTitle>
      {error ? (
        <MutedText style={{ color: colors.red }}>{error}</MutedText>
      ) : !preview ? (
        <MutedText>{t('common.loading')}</MutedText>
      ) : !ok ? (
        <MutedText>{t('documentDelete.goneBody')}</MutedText>
      ) : (
        <>
          {ok.settlements.length > 0 && (
            <Text style={styles.headline}>
              {t('documentDelete.wholeSettlement', { week: ok.settlements[0].week_ending ? date(ok.settlements[0].week_ending) : '—' })}
            </Text>
          )}
          {ok.tables
            .filter((row) => row.kind !== 'kept')
            .map((row) => (
              <View key={`${row.table}-${row.kind}`} style={styles.row}>
                <MutedText style={{ flex: 1 }}>
                  {t(`documentDelete.tables.${row.table}`, { defaultValue: row.table })}
                  {row.kind === 'attached' ? ` ${t('documentDelete.attachedTag')}` : ''}
                </MutedText>
                <Text style={styles.value}>
                  {row.count}
                  {row.amount ? ` · ${money(row.amount)}` : ''}
                </Text>
              </View>
            ))}
          {linked === 0 && <MutedText>{t('documentDelete.nothingLinked')}</MutedText>}
          {ok.tables
            .filter((row) => row.kind === 'kept')
            .map((row) => (
              <MutedText key={`kept-${row.table}`} style={{ marginTop: spacing.xs }}>
                {t('documentDelete.loansKept', { count: row.count })}
              </MutedText>
            ))}
          {effect && linked > 0 && (
            <Text style={[styles.value, { marginTop: spacing.sm }]}>
              {t('documentDelete.profitEffect', { week: date(effect.weekEnding), before: money(effect.before), after: money(effect.after) })}
            </Text>
          )}
          <MutedText style={{ color: colors.red, marginTop: spacing.sm }}>{t('documentDelete.irreversible')}</MutedText>

          {weekToType && (
            <>
              <MutedText style={{ marginTop: spacing.sm }}>{t('documentDelete.typeWeek', { week: weekToType })}</MutedText>
              <Field value={typed} onChangeText={setTyped} placeholder={weekToType} autoCapitalize="none" />
            </>
          )}

          <PrimaryButton title={t('documentDelete.deleteAll')} onPress={() => run('all')} loading={busy === 'all'} disabled={!canDeleteAll || !!busy} />
          {linked > 0 && (
            <SecondaryButton title={t('documentDelete.deleteFileOnly')} onPress={() => run('file_only')} loading={busy === 'file_only'} disabled={!!busy} />
          )}
        </>
      )}
      <SecondaryButton title={t('common.cancel')} onPress={onClose} disabled={!!busy} />
    </ModalSheet>
  );
}

const styles = {
  headline: { color: colors.red, fontWeight: '700' as const, fontSize: typography.size.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 2 },
  value: { color: colors.text, fontWeight: '600' as const },
};
