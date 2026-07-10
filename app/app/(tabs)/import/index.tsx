import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { callAiImport, friendlyAiImportError, type AiImportError } from '@/src/data/aiImportCall';
import { fetchExistingDocsForDuplicateCheck, saveExtraction, type SaveExtractionResult } from '@/src/data/aiImportSave';
import { buildAndUploadBackupSnapshot } from '@/src/data/backupSnapshot';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { checkDuplicateImport, type DuplicateCheckResult } from '@/src/import/duplicateCheck';
import { resolveTruckMatch } from '@/src/import/truckMatch';
import { isPersonalPayment, normalizePaymentMethod } from '@/src/import/paymentMethods';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { useDocTypeMeta } from '@/src/import/docTypes';
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

function buildPreviewLines(d: Extraction, t: TFunction): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const p1 = 'importScreen.previewLabels';
  if (d.docType === 'settlement' && d.settlement) {
    const s = d.settlement;
    lines.push({ label: t(`${p1}.grossRevenue`), value: money(s.grossRevenue), color: colors.green });
    lines.push({ label: t(`${p1}.netPay`), value: money(s.netPay), color: colors.accent });
    lines.push({ label: t(`${p1}.deductions`), value: money(s.totalDeductions), color: colors.red });
    lines.push({ label: t(`${p1}.milesLabel`), value: t(`${p1}.miles`, { count: s.totalMiles ?? 0 }) });
    lines.push({ label: t(`${p1}.loadsLabel`), value: t(`${p1}.loads`, { count: (s.loads ?? []).length }) });
    const tractorFuel = (s.tractorFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    const reeferFuel = (s.reeferFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    if (tractorFuel) lines.push({ label: t(`${p1}.tractorFuel`), value: money(tractorFuel), color: colors.red });
    if (reeferFuel) lines.push({ label: t(`${p1}.reeferFuel`), value: money(reeferFuel), color: colors.red });
    for (const x of (s.deductions ?? []).slice(0, 4)) {
      lines.push({ label: `${x.code ?? ''} ${x.desc ?? ''}`.trim(), value: money(x.amount), color: colors.red });
    }
  } else if (d.docType === 'fuel' && d.fuel) {
    const f = d.fuel;
    lines.push({ label: t(`${p1}.type`), value: f.type ?? '—' });
    lines.push({ label: t(`${p1}.station`), value: f.station ?? '—' });
    lines.push({ label: t(`${p1}.gallonsLabel`), value: t(`${p1}.gallons`, { count: Number((f.gallons ?? 0).toFixed(1)) }) });
    lines.push({ label: t(`${p1}.gross`), value: money(f.gross), color: colors.red });
    lines.push({ label: t(`${p1}.discount`), value: money(f.discount), color: colors.green });
    lines.push({ label: t(`${p1}.net`), value: money(f.net), color: colors.red });
  } else if ((d.docType === 'amazon' || d.docType === 'store') && d.purchase) {
    const p = d.purchase;
    for (const item of p.items ?? []) {
      const qty = Math.max(1, parseInt(String(item.qty ?? 1), 10) || 1);
      const label = qty > 1 ? `${qty}× ${item.name ?? ''} (@${money(item.price)} each)` : item.name ?? '';
      lines.push({ label, value: money((item.price ?? 0) * qty), color: colors.accent });
    }
    if (p.tax) lines.push({ label: t(`${p1}.tax`), value: money(p.tax), color: colors.red });
    lines.push({ label: t(`${p1}.total`), value: money(p.total ?? d.totalAmount), color: colors.green });
    if (p.paymentMethod) {
      const personal = isPersonalPayment(p.paymentMethod);
      lines.push({
        label: t(`${p1}.paymentMethod`),
        value: personal ? t(`${p1}.paymentMethodContribution`, { method: p.paymentMethod }) : p.paymentMethod,
        color: personal ? colors.orange : colors.muted,
      });
    }
  } else if (d.docType === 'maintenance' && d.maintenance) {
    const m = d.maintenance;
    lines.push({ label: t(`${p1}.shop`), value: m.shop ?? '—' });
    lines.push({ label: t(`${p1}.invoice`), value: m.invoice ?? '—' });
    lines.push({
      label: t(`${p1}.odometerLabel`),
      value: m.odometer ? t(`${p1}.odometer`, { count: m.odometer }) : '—',
    });
    lines.push({ label: t(`${p1}.totalCost`), value: money(m.total), color: colors.red });
    if (m.warrantyCredit) lines.push({ label: t(`${p1}.warrantyCredit`), value: money(m.warrantyCredit), color: colors.green });
  }
  return lines;
}

export default function Import() {
  const { t } = useTranslation();
  const docTypeMeta = useDocTypeMeta();
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
    setWorkingLabel(t('importScreen.compressingPhoto'));
    try {
      const compressed = await manipulateAsync(uri, [{ resize: { width: 1600 } }], {
        compress: 0.8,
        format: SaveFormat.JPEG,
      });
      setFileMeta({ uri: compressed.uri, ext: 'jpg', mediaType: 'image/jpeg' });
      setWorkingLabel(t('importScreen.readingDocument'));
      const base64 = await new File(compressed.uri).base64();
      setWorkingLabel(t('importScreen.aiProcessing'));
      const { data, error } = await callAiImport(base64, 'image/jpeg');
      if (error) return handleAiError(error);
      if (data) await afterExtraction(data, undefined);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('importScreen.couldNotProcessPhoto'));
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
    setWorkingLabel(t('importScreen.readingDocument'));
    try {
      setFileMeta({ uri: asset.uri, ext: 'pdf', mediaType: 'application/pdf', name: asset.name });
      const base64 = await new File(asset.uri).base64();
      setWorkingLabel(t('importScreen.aiProcessing'));
      const { data, error } = await callAiImport(base64, 'application/pdf');
      if (error) return handleAiError(error);
      if (data) await afterExtraction(data, asset.name);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('importScreen.couldNotProcessFile'));
      setPhase('error');
    }
  }

  async function handleSave() {
    if (!extraction || !fileMeta || !userId) return;
    if (needsTruckPicker && !truckId) return;

    const isPurchase = extraction.docType === 'amazon' || extraction.docType === 'store';
    const payMethod = normalizePaymentMethod(extraction.purchase?.paymentMethod);
    const hasPersonalPurchase = isPurchase && isPersonalPayment(payMethod);
    const createContribution = hasPersonalPurchase ? await confirmOwnerContribution(payMethod) : false;

    setPhase('saving');
    try {
      const saved = await saveExtraction({
        extraction,
        userId,
        truckId,
        fileUri: fileMeta.uri,
        fileExt: fileMeta.ext,
        mediaType: fileMeta.mediaType,
        createContribution,
      });
      setResult(saved);
      setPhase('done');
      await invalidateFinancialData(queryClient);
      buildAndUploadBackupSnapshot(userId); // fire-and-forget
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('importScreen.saveFailed'));
      setPhase('error');
    }
  }

  const hasDuplicate = !!duplicates && (duplicates.byContent.length > 0 || duplicates.byFilename.length > 0);
  const meta = extraction ? docTypeMeta(extraction.docType) : null;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('importScreen.title')}</ScreenTitle>

        {phase === 'pick' && (
          <Card>
            <MutedText>{t('importScreen.pickPrompt')}</MutedText>
            <PrimaryButton title={t('importScreen.takePhoto')} onPress={() => router.push('/(tabs)/import/camera')} />
            <SecondaryButton title={t('importScreen.chooseFromGallery')} onPress={pickFromGallery} />
            <SecondaryButton title={t('importScreen.choosePdf')} onPress={pickPdf} />
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
              <Text style={{ fontSize: 28, marginEnd: spacing.sm }}>{meta.icon}</Text>
              <View>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg }}>{meta.label}</Text>
                <MutedText>{t('importScreen.goesTo', { route: meta.route })}</MutedText>
              </View>
            </View>

            {hasDuplicate && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.possibleDuplicateTitle')}</Text>
                {duplicates!.byContent.length > 0 && (
                  <MutedText>
                    {t('importScreen.duplicateByContent', {
                      label: meta?.label ?? t('docTypes.other.label'),
                      date: extraction.date,
                      amount: money(extraction.totalAmount),
                    })}
                  </MutedText>
                )}
                {duplicates!.byFilename.length > 0 && <MutedText>{t('importScreen.duplicateByFilename')}</MutedText>}
              </View>
            )}

            <View style={{ marginBottom: spacing.sm }}>
              <MutedText>{t('importScreen.dateLabel', { date: extraction.date ?? '—' })}</MutedText>
              <MutedText>{t('importScreen.vendorLabel', { vendor: extraction.vendor ?? '—' })}</MutedText>
              <MutedText>{t('importScreen.amountLabel', { amount: money(extraction.totalAmount) })}</MutedText>
              <MutedText>
                {t('importScreen.deductibleLabel', {
                  value: extraction.taxDeductible ? t('importScreen.deductibleYes') : t('importScreen.deductibleNo'),
                })}
              </MutedText>
              {extraction.summary ? <MutedText>{extraction.summary}</MutedText> : null}
            </View>

            {buildPreviewLines(extraction, t).map((line, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <MutedText>{line.label}</MutedText>
                <Text style={{ color: line.color ?? colors.text, fontWeight: '600' }}>{line.value}</Text>
              </View>
            ))}

            {needsTruckPicker && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('importScreen.whichTruck')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {trucks.map((truck) => (
                    <Pressable
                      key={truck.id}
                      onPress={() => setTruckId(truck.id)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderColor: truckId === truck.id ? colors.accent : colors.border,
                        backgroundColor: truckId === truck.id ? colors.accent : colors.card2,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        {t('common.unit', { unit: truck.unit_number ?? truck.id })}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <PrimaryButton
              title={hasDuplicate ? t('importScreen.saveAnyway') : t('importScreen.save')}
              onPress={handleSave}
              disabled={needsTruckPicker && !truckId}
            />
            <SecondaryButton title={t('importScreen.discard')} onPress={reset} />
          </Card>
        )}

        {phase === 'saving' && (
          <Card>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>{t('importScreen.saving')}</Text>
          </Card>
        )}

        {phase === 'done' && result && extraction && (
          <Card>
            <Text style={{ color: colors.green, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.sm }}>
              {t('importScreen.saved')}
            </Text>
            {result.netPayAdded != null && (
              <MutedText>{t('importScreen.balanceAdded', { amount: money(result.netPayAdded) })}</MutedText>
            )}
            {result.contributionTotal > 0 && (
              <MutedText>
                {t('importScreen.contributionAdded', { amount: money(result.contributionTotal) })}
              </MutedText>
            )}
            {result.storagePath && <MutedText>{t('importScreen.savedToPath', { path: result.storagePath })}</MutedText>}
            <SecondaryButton title={t('importScreen.importAnother')} onPress={reset} />
          </Card>
        )}

        {phase === 'error' && (
          <Card>
            <ErrorText>{errorMessage}</ErrorText>
            <SecondaryButton title={t('importScreen.tryAgain')} onPress={reset} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
