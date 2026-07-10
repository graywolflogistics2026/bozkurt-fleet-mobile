import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Card, MutedText, PrimaryButton, SecondaryButton, ErrorText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { LegacyBackupPayload } from '@/src/data/legacyImport/types';
import { buildImportPreview, type LegacyImportPreview } from '@/src/data/legacyImport/preview';
import { importLegacyBackup, type ImportProgress, type LegacyImportResult } from '@/src/data/legacyImport/importLegacyBackup';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { formatDateTime } from '@/src/i18n/format';

type Phase = 'pick' | 'preview' | 'importing' | 'done' | 'error';

function Row({ label, value }: { label: string; value: number | string }) {
  if (value === 0 || value === '0') return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
      <MutedText>{label}</MutedText>
      <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

function EntityRow({ entity, t }: { entity: LegacyImportResult['entities'][number]; t: TFunction }) {
  const total = entity.inserted + entity.skipped + entity.failed;
  if (total === 0) return null;
  const parts = [t('importLegacy.entityNew', { count: entity.inserted }), t('importLegacy.entityAlreadyPresent', { count: entity.skipped })];
  if (entity.failed > 0) parts.push(t('importLegacy.entityFailed', { count: entity.failed }));
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <MutedText>{entity.label}</MutedText>
        <Text
          style={{
            color: entity.failed > 0 ? colors.red : colors.text,
            fontSize: typography.size.md,
            fontWeight: '600',
          }}
        >
          {parts.join(', ')}
        </Text>
      </View>
      {entity.failed > 0 && entity.firstError && (
        <Text style={{ color: colors.red, fontSize: typography.size.xs, marginTop: 2 }}>
          {t('importLegacy.firstError', { error: entity.firstError })}
        </Text>
      )}
    </View>
  );
}

export default function ImportLegacyBackup() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState<string | null>(null);
  const [payload, setPayload] = useState<LegacyBackupPayload | null>(null);
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<LegacyImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function pickFile() {
    setErrorMessage(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    try {
      const text = await new File(asset.uri).text();
      const parsed = JSON.parse(text) as LegacyBackupPayload;
      if (typeof parsed !== 'object' || parsed === null) throw new Error(t('importLegacy.notValidBackupFile'));
      setFileName(asset.name);
      setPayload(parsed);
      setPreview(buildImportPreview(parsed));
      setPhase('preview');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('importLegacy.couldNotReadFile'));
      setPhase('error');
    }
  }

  async function runImport() {
    if (!payload || !session) return;
    setPhase('importing');
    setProgress(null);
    try {
      const res = await importLegacyBackup(payload, session.user.id, setProgress);
      setResult(res);
      setPhase('done');
      // New rows landed across most entities — refresh every affected query
      // and force an immediate refetch (see queryInvalidation.ts) rather
      // than relying on the default active-observer-only refetch.
      await invalidateFinancialData(queryClient);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('importLegacy.importFailed'));
      setPhase('error');
    }
  }

  function reset() {
    setPhase('pick');
    setFileName(null);
    setPayload(null);
    setPreview(null);
    setProgress(null);
    setResult(null);
    setErrorMessage(null);
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('importLegacy.title')}</ScreenTitle>

        {phase === 'pick' && (
          <Card>
            <MutedText>{t('importLegacy.pickPrompt')}</MutedText>
            <PrimaryButton title={t('importLegacy.chooseFile')} onPress={pickFile} />
          </Card>
        )}

        {phase === 'preview' && preview && (
          <Card>
            <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '700', marginBottom: spacing.sm }}>
              {fileName}
            </Text>
            {preview.exportedAt && (
              <MutedText>{t('importLegacy.exportedAt', { date: formatDateTime(preview.exportedAt, i18n.language) })}</MutedText>
            )}
            <View style={{ marginTop: spacing.md }}>
              <Row label={t('importLegacy.rows.settlements')} value={preview.settlements} />
              {preview.settlementsMissingWeekEnding > 0 && (
                <MutedText>
                  {t('importLegacy.missingWeekEnding', {
                    missing: preview.settlementsMissingWeekEnding,
                    total: preview.settlements,
                  })}
                </MutedText>
              )}
              <Row label={t('importLegacy.rows.loads')} value={preview.loads} />
              <Row label={t('importLegacy.rows.fuelPurchases')} value={preview.fuelPurchases} />
              <Row label={t('importLegacy.rows.deductions')} value={preview.deductions} />
              <Row label={t('importLegacy.rows.maintenanceRecords')} value={preview.maintenanceRecords} />
              <Row label={t('importLegacy.rows.tolls')} value={preview.tolls} />
              <Row label={t('importLegacy.rows.reimbursements')} value={preview.reimbursements} />
              <Row label={t('importLegacy.rows.loans')} value={preview.loans} />
              <Row label={t('importLegacy.rows.creditCards')} value={preview.creditCards} />
              <Row label={t('importLegacy.rows.capitalDraws')} value={preview.capitalDraws} />
              <Row label={t('importLegacy.rows.capitalContributions')} value={preview.capitalContributions} />
              <Row label={t('importLegacy.rows.bankStatements')} value={preview.bankStatements} />
              <Row label={t('importLegacy.rows.checkingStatements')} value={preview.checkingStatements} />
              {preview.hasHealthData && <MutedText>{t('importLegacy.healthDataPresent')}</MutedText>}
              {preview.hasBizBalance && <MutedText>{t('importLegacy.bizBalancePresent')}</MutedText>}
            </View>
            <PrimaryButton title={t('importLegacy.importThisFile')} onPress={runImport} />
            <SecondaryButton title={t('importLegacy.chooseDifferentFile')} onPress={reset} />
          </Card>
        )}

        {phase === 'importing' && (
          <Card>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>
              {progress
                ? t('importLegacy.progress', { label: progress.label, index: progress.index + 1, total: progress.total })
                : t('importLegacy.startingImport')}
            </Text>
          </Card>
        )}

        {phase === 'done' && result && (
          <Card>
            {(() => {
              const totalFailed = result.entities.reduce((sum, e) => sum + e.failed, 0);
              return (
                <Text
                  style={{
                    color: totalFailed > 0 ? colors.orange : colors.green,
                    fontSize: typography.size.lg,
                    fontWeight: '700',
                    marginBottom: spacing.sm,
                  }}
                >
                  {totalFailed > 0
                    ? t('importLegacy.importFinishedWithFailures', { count: totalFailed })
                    : t('importLegacy.importComplete')}
                </Text>
              );
            })()}
            <MutedText>
              {result.truckId
                ? result.truckCreated
                  ? result.truckLabel
                    ? t('importLegacy.truckCreatedWithUnit', { unit: result.truckLabel })
                    : t('importLegacy.truckCreatedNoUnit')
                  : result.truckLabel
                    ? t('importLegacy.truckMatchedWithUnit', { unit: result.truckLabel })
                    : t('importLegacy.truckMatchedNoUnit')
                : t('importLegacy.truckFailed')}
            </MutedText>
            <View style={{ marginTop: spacing.md }}>
              {result.entities.map((e) => (
                <EntityRow key={e.label} entity={e} t={t} />
              ))}
            </View>
            {result.warnings.length > 0 && (
              <View style={{ marginTop: spacing.md }}>
                {result.warnings.map((w, i) => (
                  <MutedText key={i}>• {w}</MutedText>
                ))}
              </View>
            )}
            <SecondaryButton title={t('importLegacy.importAnother')} onPress={reset} />
          </Card>
        )}

        {phase === 'error' && (
          <Card>
            <ErrorText>{errorMessage}</ErrorText>
            <SecondaryButton title={t('importLegacy.tryAgain')} onPress={reset} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
