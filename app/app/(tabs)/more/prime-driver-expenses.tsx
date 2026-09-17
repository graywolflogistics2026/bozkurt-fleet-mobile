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
import { useProfile } from '@/src/data/profile';
import { useTrucksList } from '@/src/data/trucks';
import { useSettlements } from '@/src/data/settlements';
import {
  usePrimeDriverExpenses,
  useInsertPrimeDriverExpense,
  useUpdatePrimeDriverExpense,
  useDeletePrimeDriverExpense,
} from '@/src/data/primeDriverExpenses';
import { uploadPrimeDriverExpenseAttachment } from '@/src/data/primeDriverExpenseAttachment';
import { PRIME_DRIVER_EXPENSE_CATEGORIES, type PrimeDriverExpenseCategory } from '@/src/primeDriverExpenses/categories';
import { buildPrimeDriverExpenseMonth, type PrimeDriverExpenseRow } from '@/src/stats/primeDriverExpenses';
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
  const trucksQuery = useTrucksList();
  const settlementsQuery = useSettlements();
  const expensesQuery = usePrimeDriverExpenses();
  const insertExpense = useInsertPrimeDriverExpense();
  const updateExpense = useUpdatePrimeDriverExpense();
  const deleteExpense = useDeletePrimeDriverExpense();

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const rows: PrimeDriverExpenseRow[] = expensesQuery.data ?? [];
  const settlements = settlementsQuery.data ?? [];

  const monthData = useMemo(() => buildPrimeDriverExpenseMonth(rows, settlements, year, month), [rows, settlements, year, month]);

  const availableYears = useMemo(() => {
    const years = new Set<number>([now.getFullYear()]);
    for (const r of rows) {
      const y = Number((r.exp_date ?? '').slice(0, 4));
      if (Number.isFinite(y) && y > 0) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }, [rows, now]);

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

  async function handleSaveEdit() {
    if (!editingRow || !editCategory) return;
    setEditSaving(true);
    try {
      await updateExpense.mutateAsync({
        id: editingRow.id,
        values: { exp_date: editDate || todayIso(), amount: Number(editAmount) || 0, category: editCategory, note: editNote.trim() || null },
      });
      await invalidateFinancialData(queryClient, { entities: ['prime_driver_expenses'] });
      setEditingRow(null);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setEditSaving(false);
    }
  }

  function handleDelete(row: PrimeDriverExpenseRow) {
    Alert.alert(t('deductions.deleteConfirmTitle'), t('deductions.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExpense.mutateAsync(row.id);
            await invalidateFinancialData(queryClient, { entities: ['prime_driver_expenses'] });
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

  const loading = expensesQuery.isLoading || settlementsQuery.isLoading;

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
                    <Pressable key={r.id} onPress={() => openEdit(r)} style={styles.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text }}>{r.exp_date ? date(r.exp_date) : ''}</Text>
                        {r.note ? <MutedText numberOfLines={1}>{r.note}</MutedText> : null}
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
                <Text style={{ color: colors.text, fontWeight: '600' }}>{monthData.daysAwayFromHome}</Text>
              </View>
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
        <MutedText>{t('primeDriverExpenses.dateLabel')}</MutedText>
        <Field value={editDate} onChangeText={setEditDate} placeholder="YYYY-MM-DD" />
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.amountLabel')}</MutedText>
        <Field value={editAmount} onChangeText={setEditAmount} keyboardType="numeric" placeholder="0.00" />
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.categoryLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PRIME_DRIVER_EXPENSE_CATEGORIES.map((c) => (
            <Pill key={c} label={c} selected={editCategory === c} onPress={() => setEditCategory(c)} />
          ))}
        </View>
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.noteLabel')}</MutedText>
        <Field value={editNote} onChangeText={setEditNote} placeholder={t('primeDriverExpenses.notePlaceholder')} />

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
