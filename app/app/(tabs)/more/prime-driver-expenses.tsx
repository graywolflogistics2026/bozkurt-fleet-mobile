import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useTrucksList } from '@/src/data/trucks';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions, useUpdateDeduction, useDeleteDeduction } from '@/src/data/deductions';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import {
  usePrimeDriverExpenses,
  useInsertPrimeDriverExpense,
  useUpdatePrimeDriverExpense,
  useDeletePrimeDriverExpense,
} from '@/src/data/primeDriverExpenses';
import { uploadPrimeDriverExpenseAttachment } from '@/src/data/primeDriverExpenseAttachment';
import { PRIME_DRIVER_EXPENSE_CATEGORIES, type PrimeDriverExpenseCategory } from '@/src/primeDriverExpenses/categories';
import { findAccountantCategoryBackfillCandidates, type BackfillCandidateRow } from '@/src/primeDriverExpenses/categoryMapping';
import {
  buildPrimeDriverExpenseMonth,
  eligibleDeductionRowsForReport,
  mergePrimeDriverExpenseRows,
  daysOverrideKey,
  type PrimeDriverExpenseRow,
} from '@/src/stats/primeDriverExpenses';
import { buildPrimeDriverExpenseReportHtml, buildPrimeDriverExpenseReportFilename } from '@/src/stats/primeDriverExpenseReport';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, LegalFootnote, Field, PrimaryButton, SecondaryButton, ModalSheet, SheetTitle } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PrimeDriverExpensesScreen() {
  const { t } = useTranslation();
  const { money, date, monthLabel } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const trucksQuery = useTrucksList();
  const settlementsQuery = useSettlements();
  const expensesQuery = usePrimeDriverExpenses();
  const insertExpense = useInsertPrimeDriverExpense();
  const updateExpense = useUpdatePrimeDriverExpense();
  const deleteExpense = useDeletePrimeDriverExpense();
  // ZERO DUPLICATION (item 5) — the report reads deductions LIVE, never a
  // copy: a deduction-sourced row shown here IS the same row Deductions'
  // own screen shows, edited/deleted through the identical hooks/cleanup
  // that screen uses (items 6/7), never a parallel write path.
  const deductionsQuery = useDeductions();
  const updateDeduction = useUpdateDeduction();
  const deleteDeduction = useDeleteDeduction();

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const directRows: PrimeDriverExpenseRow[] = useMemo(
    () => (expensesQuery.data ?? []).map((r) => ({ ...r, origin: 'direct' as const })),
    [expensesQuery.data]
  );
  const deductionRows = useMemo(() => eligibleDeductionRowsForReport(deductionsQuery.data ?? []), [deductionsQuery.data]);
  const rows: PrimeDriverExpenseRow[] = useMemo(() => mergePrimeDriverExpenseRows(directRows, deductionRows), [directRows, deductionRows]);
  const settlements = settlementsQuery.data ?? [];

  // DAYS AWAY FROM HOME OVERRIDE (item 8) — a per-month correction stored
  // on profiles.prime_driver_days_override (docs/PENDING_SQL.md §75),
  // keyed "YYYY-MM" — read-only default is the auto-computed figure;
  // setting a value here NEVER writes back to settlements.per_diem_days,
  // calcPerDiemDays(), Tax Estimator, or the Accountant Package's own
  // per-diem block (all of those keep reading the real calculated figure
  // regardless — see src/stats/primeDriverExpenses.ts's own header
  // comment for the isolation proof).
  const daysOverrideMap = profileQuery.data?.prime_driver_days_override ?? {};
  const currentDaysOverride = daysOverrideMap[daysOverrideKey(year, month)] ?? null;

  const monthData = useMemo(
    () => buildPrimeDriverExpenseMonth(rows, settlements, year, month, currentDaysOverride),
    [rows, settlements, year, month, currentDaysOverride]
  );

  const availableYears = useMemo(() => {
    const years = new Set<number>([now.getFullYear()]);
    for (const r of rows) {
      const y = Number((r.exp_date ?? '').slice(0, 4));
      if (Number.isFinite(y) && y > 0) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }, [rows, now]);

  // "DAYS AWAY FROM HOME" — inline edit state.
  const [editingDays, setEditingDays] = useState(false);
  const [daysInput, setDaysInput] = useState('');
  async function handleSaveDaysOverride() {
    const n = Number(daysInput);
    if (!Number.isFinite(n) || n < 0) return;
    await updateProfile.mutateAsync({ prime_driver_days_override: { ...daysOverrideMap, [daysOverrideKey(year, month)]: n } });
    setEditingDays(false);
  }
  async function handleResetDaysOverride() {
    const next = { ...daysOverrideMap };
    delete next[daysOverrideKey(year, month)];
    await updateProfile.mutateAsync({ prime_driver_days_override: next });
  }

  // AUTO-SUGGEST FOR EXISTING HISTORY (item 3) — a one-time, idempotent
  // backfill over already-imported out-of-pocket deductions, using the
  // owner-approved mapping (categoryMapping.ts). Never overwrites a row
  // that already has a non-null accountant_category, whether auto-set by
  // an earlier run or manually corrected — safe to tap any number of
  // times.
  const [backfilling, setBackfilling] = useState(false);
  const backfillCandidates = useMemo(() => {
    const candidateRows: BackfillCandidateRow[] = (deductionsQuery.data ?? []).map((d) => ({
      id: d.id,
      category: d.category,
      source: d.source,
      accountant_category: d.accountant_category,
    }));
    return findAccountantCategoryBackfillCandidates(candidateRows);
  }, [deductionsQuery.data]);
  async function handleRunBackfill() {
    setBackfilling(true);
    try {
      for (const c of backfillCandidates) {
        await updateDeduction.mutateAsync({ id: c.id, values: { accountant_category: c.accountantCategory } });
      }
      await invalidateFinancialData(queryClient, { entities: ['deductions'] });
      Alert.alert(t('primeDriverExpenses.backfillDoneTitle'), t('primeDriverExpenses.backfillDoneBody', { count: backfillCandidates.length }));
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setBackfilling(false);
    }
  }

  const companyName = profileQuery.data?.company_name?.trim() || null;
  const activeTruck = (trucksQuery.data ?? []).find((tr) => tr.is_active) ?? (trucksQuery.data ?? [])[0] ?? null;
  const truckLabel = activeTruck?.unit_number ? `Unit ${activeTruck.unit_number}` : null;
  const periodLabel = monthLabel(year, month, { year: 'numeric', month: 'long' });
  const headerLine = [companyName, truckLabel, periodLabel].filter(Boolean).join(' — ') || t('primeDriverExpenses.title');
  const monthNames = Array.from({ length: 12 }, (_, i) => monthLabel(year, i + 1, { month: 'short' }));

  // Add sheet state
  const [adding, setAdding] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addDate, setAddDate] = useState(todayIso());
  const [addAmount, setAddAmount] = useState('');
  const [addCategory, setAddCategory] = useState<PrimeDriverExpenseCategory | null>(null);
  const [addNote, setAddNote] = useState('');
  const [addAttaching, setAddAttaching] = useState(false);
  const [addAttachmentDocumentId, setAddAttachmentDocumentId] = useState<string | null>(null);
  const [addAttachmentFilename, setAddAttachmentFilename] = useState<string | null>(null);

  function openAdd() {
    setAddDate(todayIso());
    setAddAmount('');
    setAddCategory(null);
    setAddNote('');
    setAddAttachmentDocumentId(null);
    setAddAttachmentFilename(null);
    setAdding(true);
  }

  async function saveAddAttachment(uri: string, filename: string, mediaType: string) {
    if (!userId) return;
    setAddAttaching(true);
    try {
      const documentId = await uploadPrimeDriverExpenseAttachment(userId, addCategory ?? 'Misc', uri, filename, mediaType, addDate || null);
      setAddAttachmentDocumentId(documentId);
      setAddAttachmentFilename(filename);
    } catch (err) {
      Alert.alert(t('deductions.attachFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setAddAttaching(false);
    }
  }

  async function handleAttachTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    await saveAddAttachment(picked.assets[0].uri, picked.assets[0].fileName || `photo-${Date.now()}.jpg`, picked.assets[0].mimeType || 'image/jpeg');
  }

  async function handleAttachChooseFromLibrary() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    await saveAddAttachment(picked.assets[0].uri, picked.assets[0].fileName || `photo-${Date.now()}.jpg`, picked.assets[0].mimeType || 'image/jpeg');
  }

  async function handleAttachImportFile() {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    await saveAddAttachment(asset.uri, asset.name, asset.mimeType || 'application/pdf');
  }

  async function handleSaveAdd() {
    if (!userId || !addCategory) return;
    const amount = Number(addAmount) || 0;
    setAddSaving(true);
    try {
      const inserted = await insertExpense.mutateAsync({
        user_id: userId,
        exp_date: addDate || todayIso(),
        amount,
        category: addCategory,
        note: addNote.trim() || null,
      });
      if (addAttachmentDocumentId) {
        try {
          await updateExpense.mutateAsync({ id: (inserted as { id: string }).id, values: { document_id: addAttachmentDocumentId } });
        } catch {
          // Non-fatal — the expense itself already saved.
        }
      }
      await invalidateFinancialData(queryClient, { entities: ['prime_driver_expenses'] });
      setAdding(false);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setAddSaving(false);
    }
  }

  // Edit sheet state
  const [editingRow, setEditingRow] = useState<PrimeDriverExpenseRow | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState<PrimeDriverExpenseCategory | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  function openEdit(row: PrimeDriverExpenseRow) {
    setEditingRow(row);
    setEditDate(row.exp_date ?? todayIso());
    setEditAmount(String(row.amount ?? 0));
    setEditCategory((row.category as PrimeDriverExpenseCategory) ?? null);
    setEditNote(row.note ?? '');
  }

  // ITEM 7 — the category picker on a DEDUCTION-sourced row is the
  // 16-value list ONLY, and editing it writes ONLY
  // `deductions.accountant_category` — never `deductions.category` (the
  // real Schedule-C category is completely untouched). Date/amount/note
  // for a deduction-sourced row are managed on Deductions' own screen,
  // not duplicated here — this report reads them live.
  async function handleSaveEdit() {
    if (!editingRow || !editCategory) return;
    setEditSaving(true);
    try {
      if (editingRow.origin === 'deduction') {
        await updateDeduction.mutateAsync({ id: editingRow.id, values: { accountant_category: editCategory } });
        await invalidateFinancialData(queryClient, { entities: ['deductions'] });
      } else {
        await updateExpense.mutateAsync({
          id: editingRow.id,
          values: { exp_date: editDate || todayIso(), amount: Number(editAmount) || 0, category: editCategory, note: editNote.trim() || null },
        });
        await invalidateFinancialData(queryClient, { entities: ['prime_driver_expenses'] });
      }
      setEditingRow(null);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setEditSaving(false);
    }
  }

  // DELETE CONSISTENCY (item 6) — a deduction-sourced row's delete calls
  // the EXACT SAME path Deductions' own screen uses (useDeleteDeduction +
  // cleanupOrphanedDocument for its linked document; the linked
  // capital_transactions row cascades automatically per CLAUDE.md
  // invariant #5) — never a parallel, thinner delete — so it disappears
  // from BOTH screens immediately, live-read, no caching. A
  // prime_driver_expenses-only row uses that table's own existing
  // delete and only ever affects this report.
  function handleDelete(row: PrimeDriverExpenseRow) {
    Alert.alert(t('deductions.deleteConfirmTitle'), t('deductions.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            if (row.origin === 'deduction') {
              const source = (deductionsQuery.data ?? []).find((d) => d.id === row.id);
              await deleteDeduction.mutateAsync(row.id);
              if (source?.document_id) await cleanupOrphanedDocument(source.document_id);
              await invalidateFinancialData(queryClient, {
                entities: source?.document_id ? ['deductions', 'capital_transactions', 'documents'] : ['deductions', 'capital_transactions'],
              });
            } else {
              await deleteExpense.mutateAsync(row.id);
              await invalidateFinancialData(queryClient, { entities: ['prime_driver_expenses'] });
            }
            setEditingRow(null);
          } catch (err) {
            Alert.alert(t('deductions.deleteFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
          }
        },
      },
    ]);
  }

  // EXPORT — a new, standalone PDF/Excel option for THIS screen's own
  // monthly view. buildPrimeDriverExpenseReportHtml() (src/stats/
  // primeDriverExpenseReport.ts) is a SEPARATE function/file from the
  // Accountant Package's own buildAccountantReportHtml() — never modifies
  // or reuses that module — but shares its exact expo-print/Sharing/
  // .xls-extension-trick pattern, no new native dependency.
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);

  function reportStrings() {
    return {
      categoryTableTitle: t('primeDriverExpenses.categoryTableTitle'),
      daysAwayFromHomeLabel: t('primeDriverExpenses.daysAwayFromHome'),
      grandTotalLabel: t('primeDriverExpenses.grandTotal'),
      noEntriesLabel: t('primeDriverExpenses.noEntries'),
      disclaimer: t('primeDriverExpenses.disclaimer'),
    };
  }

  async function handleExportPdf() {
    setExporting('pdf');
    try {
      const html = buildPrimeDriverExpenseReportHtml(headerLine, monthData, reportStrings(), { money, date });
      const { uri } = await Print.printToFileAsync({ html });
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(t('accountantPackage.shareNotAvailable'));
        return;
      }
      const filename = buildPrimeDriverExpenseReportFilename(year, month, 'pdf');
      const renamed = new File(Paths.cache, filename);
      if (renamed.exists) renamed.delete();
      new File(uri).copy(renamed);
      await Sharing.shareAsync(renamed.uri);
    } catch (err) {
      Alert.alert(t('accountantPackage.exportFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setExporting(null);
    }
  }

  async function handleExportExcel() {
    setExporting('excel');
    try {
      const html = buildPrimeDriverExpenseReportHtml(headerLine, monthData, reportStrings(), { money, date });
      const filename = buildPrimeDriverExpenseReportFilename(year, month, 'xls');
      const file = new File(Paths.cache, filename);
      if (file.exists) file.delete();
      file.create();
      file.write(html);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(t('accountantPackage.shareNotAvailable'));
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: 'application/vnd.ms-excel' });
    } catch (err) {
      Alert.alert(t('accountantPackage.exportFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setExporting(null);
    }
  }

  const loading = expensesQuery.isLoading || settlementsQuery.isLoading || deductionsQuery.isLoading;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('primeDriverExpenses.title')}</ScreenTitle>
        <MutedText>{t('primeDriverExpenses.subtitle')}</MutedText>

        {/* LEGAL DISCLAIMER (item 7) — a record-keeping-accuracy notice,
            deliberately different from the tax-estimate disclaimer
            (invariant #8) but rendered via the SAME shared LegalFootnote
            component, which already accepted custom children before this
            pass. */}
        <LegalFootnote>{t('primeDriverExpenses.disclaimer')}</LegalFootnote>

        <Text style={styles.sectionTitle}>{t('primeDriverExpenses.yearLabel')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {availableYears.map((y) => (
            <Pill key={y} label={String(y)} selected={year === y} onPress={() => setYear(y)} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t('primeDriverExpenses.monthLabel')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {monthNames.map((label, i) => (
            <Pill key={i} label={label} selected={month === i + 1} onPress={() => setMonth(i + 1)} />
          ))}
        </View>

        <PrimaryButton title={`➕ ${t('primeDriverExpenses.addExpense')}`} onPress={openAdd} />

        {/* AUTO-SUGGEST FOR EXISTING HISTORY (item 3) — a one-time,
            re-runnable backfill; only shown when there's genuinely
            something left to fill in. */}
        {backfillCandidates.length > 0 && (
          <SecondaryButton
            title={`🔄 ${t('primeDriverExpenses.backfillButton', { count: backfillCandidates.length })}`}
            onPress={handleRunBackfill}
            loading={backfilling}
          />
        )}

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            {monthData.sections.map((section) => (
              <Card key={section.category} style={{ marginTop: spacing.md }}>
                <View style={styles.row}>
                  <Text style={styles.categoryTitle}>{section.category}</Text>
                  <Text style={styles.subtotal}>{money(section.subtotal)}</Text>
                </View>
                {section.rows.length === 0 ? (
                  <MutedText style={{ marginTop: spacing.xs }}>{t('primeDriverExpenses.noEntries')}</MutedText>
                ) : (
                  section.rows.map((r) => (
                    <Pressable key={`${r.origin}-${r.id}`} onPress={() => openEdit(r)} style={styles.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text }}>{r.exp_date ? date(r.exp_date) : ''}</Text>
                        {r.note ? <MutedText numberOfLines={1}>{r.note}</MutedText> : null}
                        {/* ZERO DUPLICATION (item 5) — a deduction-sourced
                            row is clearly labeled so the user is never
                            tempted to double-enter the same expense in
                            both places. */}
                        {r.origin === 'deduction' && (
                          <MutedText style={{ color: colors.accent, fontSize: typography.size.xs }}>
                            {t('primeDriverExpenses.fromDeductions', { date: r.exp_date ? date(r.exp_date) : '' })}
                          </MutedText>
                        )}
                      </View>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{money(Number(r.amount ?? 0))}</Text>
                    </Pressable>
                  ))
                )}
              </Card>
            ))}

            <Card style={{ marginTop: spacing.md }}>
              <View style={styles.row}>
                <MutedText>{t('primeDriverExpenses.daysAwayFromHome')}</MutedText>
                {editingDays ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Field
                      value={daysInput}
                      onChangeText={setDaysInput}
                      keyboardType="numeric"
                      style={{ width: 60, marginBottom: 0 }}
                    />
                    <Pressable onPress={handleSaveDaysOverride} hitSlop={8} style={{ marginStart: spacing.sm }}>
                      <Text style={{ color: colors.accent, fontWeight: '700' }}>{t('common.save')}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      setDaysInput(String(monthData.daysAwayFromHome));
                      setEditingDays(true);
                    }}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>
                      {monthData.daysAwayFromHome} {monthData.daysAwayFromHomeIsOverridden ? '✎' : ''}
                    </Text>
                  </Pressable>
                )}
              </View>
              {monthData.daysAwayFromHomeIsOverridden && !editingDays && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 }}>
                  <MutedText style={{ fontSize: typography.size.xs, marginEnd: spacing.sm }}>{t('primeDriverExpenses.manuallySet')}</MutedText>
                  <Pressable onPress={handleResetDaysOverride} hitSlop={8}>
                    <Text style={{ color: colors.accent, fontSize: typography.size.xs, fontWeight: '600' }}>
                      {t('primeDriverExpenses.resetToCalculated')}
                    </Text>
                  </Pressable>
                </View>
              )}
              <View style={[styles.row, { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }]}>
                <Text style={styles.categoryTitle}>{t('primeDriverExpenses.grandTotal')}</Text>
                <Text style={styles.grandTotal}>{money(monthData.grandTotal)}</Text>
              </View>
            </Card>

            <Card style={{ marginTop: spacing.md }}>
              <Text style={styles.categoryTitle}>{t('primeDriverExpenses.exportTitle')}</Text>
              <PrimaryButton title={`📄 ${t('primeDriverExpenses.exportPdf')}`} onPress={handleExportPdf} loading={exporting === 'pdf'} />
              <SecondaryButton title={`📊 ${t('primeDriverExpenses.exportExcel')}`} onPress={handleExportExcel} loading={exporting === 'excel'} />
            </Card>
          </>
        )}
      </ScrollView>

      <ModalSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetTitle>{t('primeDriverExpenses.addExpense')}</SheetTitle>
        <MutedText>{t('primeDriverExpenses.dateLabel')}</MutedText>
        <Field value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD" />
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.amountLabel')}</MutedText>
        <Field value={addAmount} onChangeText={setAddAmount} keyboardType="numeric" placeholder="0.00" />
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.categoryLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PRIME_DRIVER_EXPENSE_CATEGORIES.map((c) => (
            <Pill key={c} label={c} selected={addCategory === c} onPress={() => setAddCategory(c)} />
          ))}
        </View>
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.noteLabel')}</MutedText>
        <Field value={addNote} onChangeText={setAddNote} placeholder={t('primeDriverExpenses.notePlaceholder')} />

        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.attachmentLabel')}</MutedText>
        {addAttachmentFilename ? (
          <MutedText style={{ color: colors.green }}>✓ {addAttachmentFilename}</MutedText>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
            <Pressable onPress={handleAttachTakePhoto} style={styles.attachButton}>
              <Text style={styles.attachButtonText}>{t('deductions.attachTakePhoto')}</Text>
            </Pressable>
            <Pressable onPress={handleAttachChooseFromLibrary} style={styles.attachButton}>
              <Text style={styles.attachButtonText}>{t('deductions.attachChooseFromLibrary')}</Text>
            </Pressable>
            <Pressable onPress={handleAttachImportFile} style={styles.attachButton}>
              <Text style={styles.attachButtonText}>{t('deductions.attachImportFile')}</Text>
            </Pressable>
          </View>
        )}
        {addAttaching && <MutedText>{t('common.loading')}</MutedText>}

        <PrimaryButton
          title={t('common.save')}
          onPress={handleSaveAdd}
          loading={addSaving}
          disabled={!addCategory || !addAmount}
        />
      </ModalSheet>

      <ModalSheet visible={!!editingRow} onClose={() => setEditingRow(null)}>
        <SheetTitle>{t('primeDriverExpenses.editExpense')}</SheetTitle>
        {editingRow?.origin === 'deduction' ? (
          // ITEM 7 — a deduction-sourced row's editor here is the 16-value
          // accountant category picker ONLY: date/amount/note are managed
          // on Deductions' own screen (this report reads them live, never
          // a copy) and the real Schedule-C category is never touched
          // from here.
          <MutedText style={{ marginBottom: spacing.sm }}>{t('primeDriverExpenses.editingDeductionNote')}</MutedText>
        ) : (
          <>
            <MutedText>{t('primeDriverExpenses.dateLabel')}</MutedText>
            <Field value={editDate} onChangeText={setEditDate} placeholder="YYYY-MM-DD" />
            <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.amountLabel')}</MutedText>
            <Field value={editAmount} onChangeText={setEditAmount} keyboardType="numeric" placeholder="0.00" />
          </>
        )}
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.categoryLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PRIME_DRIVER_EXPENSE_CATEGORIES.map((c) => (
            <Pill key={c} label={c} selected={editCategory === c} onPress={() => setEditCategory(c)} />
          ))}
        </View>
        {editingRow?.origin !== 'deduction' && (
          <>
            <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.noteLabel')}</MutedText>
            <Field value={editNote} onChangeText={setEditNote} placeholder={t('primeDriverExpenses.notePlaceholder')} />
          </>
        )}

        <PrimaryButton title={t('common.save')} onPress={handleSaveEdit} loading={editSaving} disabled={!editCategory} />
        <Pressable onPress={() => editingRow && handleDelete(editingRow)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.red, fontWeight: '700', fontSize: typography.size.sm }}>{t('common.delete')}</Text>
        </Pressable>
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  categoryTitle: {
    color: colors.text,
    fontWeight: '700' as const,
    fontSize: typography.size.md,
  },
  subtotal: {
    color: colors.text,
    fontWeight: '700' as const,
  },
  grandTotal: {
    color: colors.green,
    fontWeight: '700' as const,
    fontSize: typography.size.lg,
  },
  lineRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card2,
    marginEnd: spacing.xs,
    marginBottom: spacing.xs,
  },
  attachButtonText: {
    color: colors.text,
    fontSize: typography.size.sm,
  },
};
