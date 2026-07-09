import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Card, MutedText, PrimaryButton, SecondaryButton, ErrorText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { LegacyBackupPayload } from '@/src/data/legacyImport/types';
import { buildImportPreview, type LegacyImportPreview } from '@/src/data/legacyImport/preview';
import { importLegacyBackup, type ImportProgress, type LegacyImportResult } from '@/src/data/legacyImport/importLegacyBackup';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';

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

function EntityRow({ entity }: { entity: LegacyImportResult['entities'][number] }) {
  const total = entity.inserted + entity.skipped + entity.failed;
  if (total === 0) return null;
  const parts = [`${entity.inserted} new`, `${entity.skipped} already present`];
  if (entity.failed > 0) parts.push(`${entity.failed} FAILED`);
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
        <Text style={{ color: colors.red, fontSize: typography.size.xs, marginTop: 2 }}>First error: {entity.firstError}</Text>
      )}
    </View>
  );
}

export default function ImportLegacyBackup() {
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
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Not a valid backup file.');
      setFileName(asset.name);
      setPayload(parsed);
      setPreview(buildImportPreview(parsed));
      setPhase('preview');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not read that file.');
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
      setErrorMessage(err instanceof Error ? err.message : 'Import failed.');
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
        <ScreenTitle>Import Legacy Backup</ScreenTitle>

        {phase === 'pick' && (
          <Card>
            <MutedText>
              Pick the JSON backup file exported from the web app (Settings → Export Data). Settlements,
              deductions, maintenance history, Truck Health, Capital Account, loans, cards, and bank/checking
              statements will be imported. Safe to run more than once — matching records are updated in place, not
              duplicated.
            </MutedText>
            <PrimaryButton title="Choose backup file" onPress={pickFile} />
          </Card>
        )}

        {phase === 'preview' && preview && (
          <Card>
            <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '700', marginBottom: spacing.sm }}>
              {fileName}
            </Text>
            {preview.exportedAt && <MutedText>Exported {new Date(preview.exportedAt).toLocaleString()}</MutedText>}
            <View style={{ marginTop: spacing.md }}>
              <Row label="Settlements" value={preview.settlements} />
              {preview.settlementsMissingWeekEnding > 0 && (
                <MutedText>
                  ⚠ {preview.settlementsMissingWeekEnding} of {preview.settlements} settlement(s) have no weekEnding — will use
                  their document date instead.
                </MutedText>
              )}
              <Row label="Loads" value={preview.loads} />
              <Row label="Fuel purchases" value={preview.fuelPurchases} />
              <Row label="Deductions" value={preview.deductions} />
              <Row label="Maintenance records" value={preview.maintenanceRecords} />
              <Row label="Tolls" value={preview.tolls} />
              <Row label="Reimbursements" value={preview.reimbursements} />
              <Row label="Loans" value={preview.loans} />
              <Row label="Credit cards" value={preview.creditCards} />
              <Row label="Capital draws" value={preview.capitalDraws} />
              <Row label="Capital contributions" value={preview.capitalContributions} />
              <Row label="Bank (card) statements" value={preview.bankStatements} />
              <Row label="Checking statements" value={preview.checkingStatements} />
              {preview.hasHealthData && <MutedText>Truck Health data present — will be applied as baseline overrides.</MutedText>}
              {preview.hasBizBalance && <MutedText>Business balance present — will update your profile.</MutedText>}
            </View>
            <PrimaryButton title="Import this file" onPress={runImport} />
            <SecondaryButton title="Choose a different file" onPress={reset} />
          </Card>
        )}

        {phase === 'importing' && (
          <Card>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>
              {progress ? `${progress.label} (${progress.index + 1}/${progress.total})` : 'Starting…'}
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
                  {totalFailed > 0 ? `Import finished with ${totalFailed} failure(s)` : 'Import complete'}
                </Text>
              );
            })()}
            <MutedText>
              {result.truckId
                ? result.truckCreated
                  ? result.truckLabel
                    ? `Created truck Unit ${result.truckLabel}.`
                    : 'Created a truck profile (no unit number in this backup).'
                  : result.truckLabel
                    ? `Matched existing truck Unit ${result.truckLabel}.`
                    : 'Matched your existing truck profile.'
                : 'Truck profile could not be created — see warnings below.'}
            </MutedText>
            <View style={{ marginTop: spacing.md }}>
              {result.entities.map((e) => (
                <EntityRow key={e.label} entity={e} />
              ))}
            </View>
            {result.warnings.length > 0 && (
              <View style={{ marginTop: spacing.md }}>
                {result.warnings.map((w, i) => (
                  <MutedText key={i}>• {w}</MutedText>
                ))}
              </View>
            )}
            <SecondaryButton title="Import another file" onPress={reset} />
          </Card>
        )}

        {phase === 'error' && (
          <Card>
            <ErrorText>{errorMessage}</ErrorText>
            <SecondaryButton title="Try again" onPress={reset} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
