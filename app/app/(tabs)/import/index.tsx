import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
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
import { useInsertTruck } from '@/src/data/trucks';
import { useDrivers, useInsertDriver } from '@/src/data/drivers';
import { callAiImport, friendlyAiImportError, type AiImportError } from '@/src/data/aiImportCall';
import { fetchExistingDocsForDuplicateCheck, saveExtraction, type SaveExtractionResult } from '@/src/data/aiImportSave';
import { buildAndUploadBackupSnapshot } from '@/src/data/backupSnapshot';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { checkDuplicateImport, type DuplicateCheckResult } from '@/src/import/duplicateCheck';
import { resolveTruckMatch } from '@/src/import/truckMatch';
import { resolveDriverMatch } from '@/src/import/driverMatch';
import { isPersonalPayment, normalizePaymentMethod } from '@/src/import/paymentMethods';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { useDocTypeMeta } from '@/src/import/docTypes';
import { consumePendingCapture } from '@/src/import/pendingCapture';
import type { Extraction } from '@/src/import/types';
import { Screen, ScreenTitle, Card, MutedText, PrimaryButton, SecondaryButton, ErrorText, Field } from '@/src/components/ui';
import { formatMoney } from '@/src/i18n/format';
import { colors, radii, spacing, typography } from '@/src/theme';

type Phase = 'pick' | 'working' | 'preview' | 'saving' | 'done' | 'error';

function money(n: number | undefined | null, locale: string) {
  if (n == null) return '—';
  return formatMoney(n, locale);
}

type PreviewLine = { label: string; value: string; color?: string };

function buildPreviewLines(d: Extraction, t: TFunction, locale: string): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const p1 = 'importScreen.previewLabels';
  if (d.docType === 'settlement' && d.settlement) {
    const s = d.settlement;
    lines.push({ label: t(`${p1}.grossRevenue`), value: money(s.grossRevenue, locale), color: colors.green });
    lines.push({ label: t(`${p1}.netPay`), value: money(s.netPay, locale), color: colors.accent });
    lines.push({ label: t(`${p1}.deductions`), value: money(s.totalDeductions, locale), color: colors.red });
    lines.push({ label: t(`${p1}.milesLabel`), value: t(`${p1}.miles`, { count: s.totalMiles ?? 0 }) });
    lines.push({ label: t(`${p1}.loadsLabel`), value: t(`${p1}.loads`, { count: (s.loads ?? []).length }) });
    const tractorFuel = (s.tractorFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    const reeferFuel = (s.reeferFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    if (tractorFuel) lines.push({ label: t(`${p1}.tractorFuel`), value: money(tractorFuel, locale), color: colors.red });
    if (reeferFuel) lines.push({ label: t(`${p1}.reeferFuel`), value: money(reeferFuel, locale), color: colors.red });
    for (const x of (s.deductions ?? []).slice(0, 4)) {
      lines.push({ label: `${x.code ?? ''} ${x.desc ?? ''}`.trim(), value: money(x.amount, locale), color: colors.red });
    }
  } else if (d.docType === 'fuel' && d.fuel) {
    const f = d.fuel;
    lines.push({ label: t(`${p1}.type`), value: f.type ?? '—' });
    lines.push({ label: t(`${p1}.station`), value: f.station ?? '—' });
    lines.push({ label: t(`${p1}.gallonsLabel`), value: t(`${p1}.gallons`, { count: Number((f.gallons ?? 0).toFixed(1)) }) });
    lines.push({ label: t(`${p1}.gross`), value: money(f.gross, locale), color: colors.red });
    lines.push({ label: t(`${p1}.discount`), value: money(f.discount, locale), color: colors.green });
    lines.push({ label: t(`${p1}.net`), value: money(f.net, locale), color: colors.red });
  } else if ((d.docType === 'amazon' || d.docType === 'store') && d.purchase) {
    const p = d.purchase;
    for (const item of p.items ?? []) {
      const qty = Math.max(1, parseInt(String(item.qty ?? 1), 10) || 1);
      const label = qty > 1 ? `${qty}× ${item.name ?? ''} (@${money(item.price, locale)} each)` : item.name ?? '';
      lines.push({ label, value: money((item.price ?? 0) * qty, locale), color: colors.accent });
    }
    if (p.tax) lines.push({ label: t(`${p1}.tax`), value: money(p.tax, locale), color: colors.red });
    lines.push({ label: t(`${p1}.total`), value: money(p.total ?? d.totalAmount, locale), color: colors.green });
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
    lines.push({ label: t(`${p1}.totalCost`), value: money(m.total, locale), color: colors.red });
    if (m.warrantyCredit) lines.push({ label: t(`${p1}.warrantyCredit`), value: money(m.warrantyCredit, locale), color: colors.green });
  } else if (d.docType === 'driver_payment' && d.driverPayment) {
    const p = d.driverPayment;
    lines.push({ label: t(`${p1}.driver`), value: p.driverName || '—' });
    lines.push({ label: t(`${p1}.total`), value: money(p.amount ?? d.totalAmount, locale), color: colors.red });
    if (p.method) lines.push({ label: t(`${p1}.method`), value: p.method });
  } else if (d.financialDoc) {
    const f = d.financialDoc;
    lines.push({ label: t(`${p1}.description`), value: f.description || d.summary || '—' });
    lines.push({ label: t(`${p1}.total`), value: money(f.amount ?? d.totalAmount, locale), color: colors.red });
    if (f.reference) lines.push({ label: t(`${p1}.reference`), value: f.reference });
    if (f.period) lines.push({ label: t(`${p1}.period`), value: f.period });
  } else if (d.docType === 'other' && d.suggestedCategory) {
    lines.push({ label: t(`${p1}.suggestedCategory`), value: d.suggestedCategory });
    lines.push({ label: t(`${p1}.total`), value: money(d.totalAmount, locale), color: colors.red });
  }
  return lines;
}

export default function Import() {
  const { t, i18n } = useTranslation();
  const docTypeMeta = useDocTypeMeta();
  const router = useRouter();
  const { session } = useAuth();
  const { trucks, refreshTrucks } = useActiveTruck();
  const { data: driversData } = useDrivers();
  const drivers = driversData ?? [];
  const insertTruck = useInsertTruck();
  const insertDriver = useInsertDriver();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  const [phase, setPhase] = useState<Phase>('pick');
  const [workingLabel, setWorkingLabel] = useState('');
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [fileMeta, setFileMeta] = useState<{ uri: string; ext: string; mediaType: string; name?: string } | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCheckResult | null>(null);
  const [truckId, setTruckId] = useState<string | null>(null);
  const [needsTruckPicker, setNeedsTruckPicker] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [needsDriverPicker, setNeedsDriverPicker] = useState(false);
  const [showNewTruckForm, setShowNewTruckForm] = useState(false);
  const [newTruckUnit, setNewTruckUnit] = useState('');
  const [creatingTruck, setCreatingTruck] = useState(false);
  const [showNewDriverForm, setShowNewDriverForm] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [creatingDriver, setCreatingDriver] = useState(false);
  const [driverShareAmount, setDriverShareAmount] = useState('');
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
    setDriverId(null);
    setNeedsDriverPicker(false);
    setShowNewTruckForm(false);
    setNewTruckUnit('');
    setShowNewDriverForm(false);
    setNewDriverName('');
    setDriverShareAmount('');
    setErrorMessage(null);
    setResult(null);
  }

  // Payroll auto-routing (owner decision 2026-07-09, PRODUCT DECISION): a
  // newly created truck/driver is picked immediately and, for trucks, the
  // shared ActiveTruckContext list is refreshed so it's available
  // everywhere else in the app right away — "remembers it" for future
  // imports is then just the normal unit_number/name match next time.
  async function handleCreateTruck() {
    const unit = newTruckUnit.trim();
    if (!userId || !unit || creatingTruck) return;
    setCreatingTruck(true);
    try {
      const created = await insertTruck.mutateAsync({ user_id: userId, unit_number: unit });
      await refreshTrucks();
      setTruckId(created.id);
      setNeedsTruckPicker(false);
      setShowNewTruckForm(false);
      setNewTruckUnit('');
    } catch (err) {
      Alert.alert(t('importScreen.createTruckFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setCreatingTruck(false);
    }
  }

  async function handleCreateDriver() {
    const name = newDriverName.trim();
    if (!userId || !name || creatingDriver) return;
    setCreatingDriver(true);
    try {
      const created = await insertDriver.mutateAsync({ user_id: userId, name });
      setDriverId(created.id);
      setNeedsDriverPicker(false);
      setShowNewDriverForm(false);
      setNewDriverName('');
    } catch (err) {
      Alert.alert(t('importScreen.createDriverFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setCreatingDriver(false);
    }
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
    const truckMatch = resolveTruckMatch(extractedUnit, trucks);
    setTruckId(truckMatch.truckId);
    setNeedsTruckPicker(truckMatch.needsPicker);

    const driverMatch = resolveDriverMatch(d.settlement?.driverName ?? d.driverPayment?.driverName, drivers);
    setDriverId(driverMatch.driverId);
    // Universal AI capture (owner decision 2026-07-10): unlike a settlement
    // (driver is optional metadata), driver_payments.driver_id is NOT
    // NULL — this docType always needs a driver picked, even with 0
    // drivers on file or no name extracted (resolveDriverMatch() alone
    // would say no picker needed in that case, which is right for
    // settlements but wrong here).
    setNeedsDriverPicker(driverMatch.needsPicker || (d.docType === 'driver_payment' && !driverMatch.driverId));

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
      const { data, error } = await callAiImport(base64, 'image/jpeg', undefined, i18n.language);
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
      const { data, error } = await callAiImport(base64, 'application/pdf', undefined, i18n.language);
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
    if (needsDriverPicker && !driverId) return;

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
        driverId,
        driverShareAmount: showsDriverSplitInput ? Number(driverShareAmount) || null : null,
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
  // Driver compensation types (owner decision 2026-07-10, PRODUCT DECISION):
  // team_split/trainee drivers get a split-entry field on the settlement
  // preview — 1099/W-2 drivers don't (their pay isn't settlement-derived).
  const selectedDriver = driverId ? drivers.find((d) => d.id === driverId) : undefined;
  const showsDriverSplitInput =
    extraction?.docType === 'settlement' &&
    !!selectedDriver &&
    (selectedDriver.compensation_type === 'team_split' || selectedDriver.compensation_type === 'trainee');

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
                      amount: money(extraction.totalAmount, i18n.language),
                    })}
                  </MutedText>
                )}
                {duplicates!.byFilename.length > 0 && <MutedText>{t('importScreen.duplicateByFilename')}</MutedText>}
              </View>
            )}

            {extraction.confidence === 'low' && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.lowConfidenceTitle')}</Text>
                <MutedText>{t('importScreen.lowConfidenceBody')}</MutedText>
              </View>
            )}

            {extraction.docType === 'government_or_misc_income' && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.miscIncomeNoteTitle')}</Text>
                <MutedText>{t('importScreen.miscIncomeNoteBody')}</MutedText>
              </View>
            )}

            <View style={{ marginBottom: spacing.sm }}>
              <MutedText>{t('importScreen.dateLabel', { date: extraction.date ?? '—' })}</MutedText>
              <MutedText>{t('importScreen.vendorLabel', { vendor: extraction.vendor ?? '—' })}</MutedText>
              <MutedText>{t('importScreen.amountLabel', { amount: money(extraction.totalAmount, i18n.language) })}</MutedText>
              <MutedText>
                {t('importScreen.deductibleLabel', {
                  value: extraction.taxDeductible ? t('importScreen.deductibleYes') : t('importScreen.deductibleNo'),
                })}
              </MutedText>
              {extraction.summary ? <MutedText>{extraction.summary}</MutedText> : null}
            </View>

            {buildPreviewLines(extraction, t, i18n.language).map((line, i) => (
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
                      onPress={() => {
                        setTruckId(truck.id);
                        setShowNewTruckForm(false);
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderColor: truckId === truck.id && !showNewTruckForm ? colors.accent : colors.border,
                        backgroundColor: truckId === truck.id && !showNewTruckForm ? colors.accent : colors.card2,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        {t('common.unit', { unit: truck.unit_number ?? truck.id })}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setShowNewTruckForm((v) => !v)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderColor: showNewTruckForm ? colors.accent : colors.border,
                      backgroundColor: showNewTruckForm ? colors.accent : colors.card2,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{t('importScreen.createNewTruck')}</Text>
                  </Pressable>
                </View>
                {showNewTruckForm && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Field
                      value={newTruckUnit}
                      onChangeText={setNewTruckUnit}
                      placeholder={t('importScreen.newTruckUnitPlaceholder')}
                    />
                    <PrimaryButton
                      title={t('common.create')}
                      onPress={handleCreateTruck}
                      loading={creatingTruck}
                      disabled={!newTruckUnit.trim()}
                    />
                  </View>
                )}
              </View>
            )}

            {needsDriverPicker && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('importScreen.whichDriver')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {drivers.map((driver) => (
                    <Pressable
                      key={driver.id}
                      onPress={() => {
                        setDriverId(driver.id);
                        setShowNewDriverForm(false);
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderColor: driverId === driver.id && !showNewDriverForm ? colors.accent : colors.border,
                        backgroundColor: driverId === driver.id && !showNewDriverForm ? colors.accent : colors.card2,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{driver.name}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setShowNewDriverForm((v) => !v)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderColor: showNewDriverForm ? colors.accent : colors.border,
                      backgroundColor: showNewDriverForm ? colors.accent : colors.card2,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{t('importScreen.createNewDriver')}</Text>
                  </Pressable>
                </View>
                {showNewDriverForm && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Field
                      value={newDriverName}
                      onChangeText={setNewDriverName}
                      placeholder={t('importScreen.newDriverNamePlaceholder')}
                    />
                    <PrimaryButton
                      title={t('common.create')}
                      onPress={handleCreateDriver}
                      loading={creatingDriver}
                      disabled={!newDriverName.trim()}
                    />
                  </View>
                )}
              </View>
            )}

            {showsDriverSplitInput && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('importScreen.driverShareLabel', { name: selectedDriver?.name ?? '' })}
                </Text>
                <Field
                  keyboardType="numeric"
                  value={driverShareAmount}
                  onChangeText={setDriverShareAmount}
                  placeholder={t('importScreen.driverSharePlaceholder')}
                />
              </View>
            )}

            <PrimaryButton
              title={hasDuplicate ? t('importScreen.saveAnyway') : t('importScreen.save')}
              onPress={handleSave}
              disabled={(needsTruckPicker && !truckId) || (needsDriverPicker && !driverId)}
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
              <MutedText>{t('importScreen.balanceAdded', { amount: money(result.netPayAdded, i18n.language) })}</MutedText>
            )}
            {result.contributionTotal > 0 && (
              <MutedText>
                {t('importScreen.contributionAdded', { amount: money(result.contributionTotal, i18n.language) })}
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
