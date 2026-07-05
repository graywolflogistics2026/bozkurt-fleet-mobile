import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { callAiImport, friendlyAiImportError, type AiImportError } from '@/src/data/aiImportCall';
import { fetchExistingDocsForDuplicateCheck, saveExtraction, type SaveExtractionResult } from '@/src/data/aiImportSave';
import { buildAndUploadBackupSnapshot } from '@/src/data/backupSnapshot';
import { checkDuplicateImport, type DuplicateCheckResult } from '@/src/import/duplicateCheck';
import { resolveTruckMatch } from '@/src/import/truckMatch';
import { isPersonalPayment } from '@/src/import/category';
import { DOC_TYPE_META } from '@/src/import/docTypes';
import { consumePendingCapture } from '@/src/import/pendingCapture';
import type { Extraction } from '@/src/import/types';
import { Screen, ScreenTitle, Card, MutedText, PrimaryButton, SecondaryButton, ErrorText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

type Phase = 'pick' | 'working' | 'preview' | 'saving' | 'done' | 'error';

function money(n: number | undefined | null) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

type PreviewLine = { label: string; value: string; color?: string };

function buildPreviewLines(d: Extraction): PreviewLine[] {
  const lines: PreviewLine[] = [];
  if (d.docType === 'settlement' && d.settlement) {
    const s = d.settlement;
    lines.push({ label: 'Gross Revenue', value: money(s.grossRevenue), color: colors.green });
    lines.push({ label: 'Net Pay', value: money(s.netPay), color: colors.accent });
    lines.push({ label: 'Deductions', value: money(s.totalDeductions), color: colors.red });
    lines.push({ label: 'Miles', value: `${(s.totalMiles ?? 0).toLocaleString()} mi` });
    lines.push({ label: 'Loads', value: `${(s.loads ?? []).length} loads` });
    const tractorFuel = (s.tractorFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    const reeferFuel = (s.reeferFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    if (tractorFuel) lines.push({ label: 'Tractor Fuel', value: money(tractorFuel), color: colors.red });
    if (reeferFuel) lines.push({ label: 'Reefer Fuel', value: money(reeferFuel), color: colors.red });
    for (const x of (s.deductions ?? []).slice(0, 4)) {
      lines.push({ label: `${x.code ?? ''} ${x.desc ?? ''}`.trim(), value: money(x.amount), color: colors.red });
    }
  } else if (d.docType === 'fuel' && d.fuel) {
    const f = d.fuel;
    lines.push({ label: 'Type', value: f.type ?? '—' });
    lines.push({ label: 'Station', value: f.station ?? '—' });
    lines.push({ label: 'Gallons', value: `${(f.gallons ?? 0).toFixed(1)} gal` });
    lines.push({ label: 'Gross', value: money(f.gross), color: colors.red });
    lines.push({ label: 'Discount', value: money(f.discount), color: colors.green });
    lines.push({ label: 'Net', value: money(f.net), color: colors.red });
  } else if ((d.docType === 'amazon' || d.docType === 'store') && d.purchase) {
    const p = d.purchase;
    for (const item of p.items ?? []) {
      const qty = Math.max(1, parseInt(String(item.qty ?? 1), 10) || 1);
      const label = qty > 1 ? `${qty}× ${item.name ?? ''} (@${money(item.price)} each)` : item.name ?? '';
      lines.push({ label, value: money((item.price ?? 0) * qty), color: colors.accent });
    }
    if (p.tax) lines.push({ label: 'Tax', value: money(p.tax), color: colors.red });
    lines.push({ label: 'TOTAL', value: money(p.total ?? d.totalAmount), color: colors.green });
    if (p.paymentMethod) {
      const personal = isPersonalPayment(p.paymentMethod);
      lines.push({
        label: 'Payment Method',
        value: p.paymentMethod + (personal ? ' (→ Capital Contribution)' : ''),
        color: personal ? colors.orange : colors.muted,
      });
    }
  } else if (d.docType === 'maintenance' && d.maintenance) {
    const m = d.maintenance;
    lines.push({ label: 'Shop', value: m.shop ?? '—' });
    lines.push({ label: 'Invoice', value: m.invoice ?? '—' });
    lines.push({ label: 'Odometer', value: m.odometer ? `${m.odometer.toLocaleString()} mi` : '—' });
    lines.push({ label: 'Total', value: money(m.total), color: colors.red });
    if (m.warrantyCredit) lines.push({ label: 'Warranty Credit', value: money(m.warrantyCredit), color: colors.green });
  }
  return lines;
}

export default function Import() {
  const router = useRouter();
  const { session } = useAuth();
  const { trucks } = useActiveTruck();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  const [phase, setPhase] = useState<Phase>('pick');
  const [workingLabel, setWorkingLabel] = useState('');
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [fileMeta, setFileMeta] = useState<{ uri: string; ext: string; mediaType: string; name?: string } | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCheckResult | null>(null);
  const [truckId, setTruckId] = useState<string | null>(null);
  const [needsTruckPicker, setNeedsTruckPicker] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<SaveExtractionResult | null>(null);

  useFocusEffect(() => {
    const uri = consumePendingCapture();
    if (uri) processImage(uri);
  });

  function reset() {
    setPhase('pick');
    setExtraction(null);
    setFileMeta(null);
    setDuplicates(null);
    setTruckId(null);
    setNeedsTruckPicker(false);
    setErrorMessage(null);
    setResult(null);
  }

  function handleAiError(err: AiImportError) {
    setErrorMessage(friendlyAiImportError(err));
    setPhase('error');
  }

  async function afterExtraction(d: Extraction, fname: string | undefined) {
    if (!userId) return;
    const existingDocs = await fetchExistingDocsForDuplicateCheck(userId);
    setDuplicates(checkDuplicateImport(d, fname, existingDocs));

    const extractedUnit = d.settlement?.unit ?? d.maintenance?.unit;
    const match = resolveTruckMatch(extractedUnit, trucks);
    setTruckId(match.truckId);
    setNeedsTruckPicker(match.needsPicker);

    setExtraction(d);
    setPhase('preview');
  }

  async function processImage(uri: string) {
    setPhase('working');
    setWorkingLabel('Compressing photo…');
    try {
      const compressed = await manipulateAsync(uri, [{ resize: { width: 1600 } }], {
        compress: 0.8,
        format: SaveFormat.JPEG,
      });
      setFileMeta({ uri: compressed.uri, ext: 'jpg', mediaType: 'image/jpeg' });
      setWorkingLabel('Reading document…');
      const base64 = await new File(compressed.uri).base64();
      setWorkingLabel('AI processing…');
      const { data, error } = await callAiImport(base64, 'image/jpeg');
      if (error) return handleAiError(error);
      if (data) await afterExtraction(data, undefined);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not process that photo.');
      setPhase('error');
    }
  }

  async function pickFromGallery() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    await processImage(picked.assets[0].uri);
  }

  async function pickPdf() {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setPhase('working');
    setWorkingLabel('Reading document…');
    try {
      setFileMeta({ uri: asset.uri, ext: 'pdf', mediaType: 'application/pdf', name: asset.name });
      const base64 = await new File(asset.uri).base64();
      setWorkingLabel('AI processing…');
      const { data, error } = await callAiImport(base64, 'application/pdf');
      if (error) return handleAiError(error);
      if (data) await afterExtraction(data, asset.name);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not process that file.');
      setPhase('error');
    }
  }

  async function handleSave() {
    if (!extraction || !fileMeta || !userId) return;
    if (needsTruckPicker && !truckId) return;
    setPhase('saving');
    try {
      const saved = await saveExtraction({
        extraction,
        userId,
        truckId,
        fileUri: fileMeta.uri,
        fileExt: fileMeta.ext,
        mediaType: fileMeta.mediaType,
      });
      setResult(saved);
      setPhase('done');
      queryClient.invalidateQueries();
      buildAndUploadBackupSnapshot(userId); // fire-and-forget
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed.');
      setPhase('error');
    }
  }

  const hasDuplicate = !!duplicates && (duplicates.byContent.length > 0 || duplicates.byFilename.length > 0);
  const meta = extraction ? DOC_TYPE_META[extraction.docType] : null;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>Import</ScreenTitle>

        {phase === 'pick' && (
          <Card>
            <MutedText>Photograph or upload a settlement, receipt, fuel ticket, or maintenance invoice.</MutedText>
            <PrimaryButton title="📷 Take Photo" onPress={() => router.push('/(tabs)/import/camera')} />
            <SecondaryButton title="🖼️ Choose from Gallery" onPress={pickFromGallery} />
            <SecondaryButton title="📄 Choose PDF" onPress={pickPdf} />
          </Card>
        )}

        {phase === 'working' && (
          <Card>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>{workingLabel}</Text>
          </Card>
        )}

        {phase === 'preview' && extraction && meta && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 28, marginRight: spacing.sm }}>{meta.icon}</Text>
              <View>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg }}>{meta.label}</Text>
                <MutedText>→ {meta.route}</MutedText>
              </View>
            </View>

            {hasDuplicate && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>⚠️ Possible duplicate</Text>
                {duplicates!.byContent.length > 0 && (
                  <MutedText>
                    A {extraction.docType} dated {extraction.date} for {money(extraction.totalAmount)} was already saved.
                  </MutedText>
                )}
                {duplicates!.byFilename.length > 0 && <MutedText>A file with this name was already imported before.</MutedText>}
              </View>
            )}

            <View style={{ marginBottom: spacing.sm }}>
              <MutedText>Date: {extraction.date ?? '—'}</MutedText>
              <MutedText>Vendor: {extraction.vendor ?? '—'}</MutedText>
              <MutedText>Amount: {money(extraction.totalAmount)}</MutedText>
              <MutedText>Deductible: {extraction.taxDeductible ? '✅ Yes' : '❌ No'}</MutedText>
              {extraction.summary ? <MutedText>{extraction.summary}</MutedText> : null}
            </View>

            {buildPreviewLines(extraction).map((line, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <MutedText>{line.label}</MutedText>
                <Text style={{ color: line.color ?? colors.text, fontWeight: '600' }}>{line.value}</Text>
              </View>
            ))}

            {needsTruckPicker && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  Which truck is this for?
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {trucks.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => setTruckId(t.id)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderColor: truckId === t.id ? colors.accent : colors.border,
                        backgroundColor: truckId === t.id ? colors.accent : colors.card2,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>Unit {t.unit_number ?? t.id}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <PrimaryButton
              title={hasDuplicate ? 'Save Anyway' : 'Save'}
              onPress={handleSave}
              disabled={needsTruckPicker && !truckId}
            />
            <SecondaryButton title="Discard" onPress={reset} />
          </Card>
        )}

        {phase === 'saving' && (
          <Card>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>Saving…</Text>
          </Card>
        )}

        {phase === 'done' && result && extraction && (
          <Card>
            <Text style={{ color: colors.green, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.sm }}>
              ✅ Saved
            </Text>
            {result.netPayAdded != null && <MutedText>💰 Balance +{money(result.netPayAdded)}</MutedText>}
            {result.contributionTotal > 0 && (
              <MutedText>
                💰 Added as a Capital Account contribution: {money(result.contributionTotal)} (paid from personal funds)
              </MutedText>
            )}
            {result.storagePath && <MutedText>📁 Saved to {result.storagePath}</MutedText>}
            <SecondaryButton title="Import Another" onPress={reset} />
          </Card>
        )}

        {phase === 'error' && (
          <Card>
            <ErrorText>{errorMessage}</ErrorText>
            <SecondaryButton title="Try Again" onPress={reset} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
