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
import { useDeductions, useInsertDeduction, useUpdateDeduction, useDeleteDeduction } from '@/src/data/deductions';
import { useReimbursements } from '@/src/data/reimbursements';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import {
  usePrimeDriverExpenses,
  useInsertPrimeDriverExpense,
  useUpdatePrimeDriverExpense,
  useDeletePrimeDriverExpense,
} from '@/src/data/primeDriverExpenses';
import { uploadPrimeDriverExpenseAttachment } from '@/src/data/primeDriverExpenseAttachment';
import { PRIME_DRIVER_EXPENSE_CATEGORIES, type PrimeDriverExpenseCategory } from '@/src/primeDriverExpenses/categories';
import {
  findAccountantCategoryBackfillCandidates,
  findLumperReimbursementGaps,
  diagnoseLumperDeductions,
  suggestAccountantCategory,
  type BackfillCandidateRow,
} from '@/src/primeDriverExpenses/categoryMapping';
import {
  buildPrimeDriverExpenseMonth,
  eligibleDeductionRowsForReport,
  mergePrimeDriverExpenseRows,
  nonPrimeSettlementIds,
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

function parseIsoParts(iso: string | null | undefined): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (match) return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// EXACT-DATE PICKER (owner decision 2026-09-23, "full control over which
// month it lands in") — pure JS year/month/day pills rather than a native
// date-picker module, so it ships over EAS Update with no new build. The
// report groups rows purely by this date (rowsInMonth()), so whatever is
// picked here is exactly the month the row is counted under.
function DatePickerField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const { t } = useTranslation();
  const { date, monthLabel } = useFormatters();
  const { y, m, d } = parseIsoParts(value);
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear - 3, thisYear - 2, thisYear - 1, thisYear, thisYear + 1, y])].sort((a, b) => a - b);
  const daysInMonth = new Date(y, m, 0).getDate();
  const pick = (ny: number, nm: number, nd: number) => onChange(toIso(ny, nm, Math.min(nd, new Date(ny, nm, 0).getDate())));

  return (
    <View>
      <Text style={{ color: colors.text, fontSize: typography.size.lg, fontWeight: '700', marginVertical: spacing.xs }}>
        📅 {date(toIso(y, m, d))}
      </Text>
      <MutedText style={{ fontSize: typography.size.xs }}>{t('primeDriverExpenses.yearLabel')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {years.map((yy) => (
          <Pill key={yy} label={String(yy)} selected={yy === y} onPress={() => pick(yy, m, d)} />
        ))}
      </View>
      <MutedText style={{ fontSize: typography.size.xs }}>{t('primeDriverExpenses.monthLabel')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
          <Pill key={mm} label={monthLabel(y, mm, { month: 'short' })} selected={mm === m} onPress={() => pick(y, mm, d)} />
        ))}
      </View>
      <MutedText style={{ fontSize: typography.size.xs }}>{t('primeDriverExpenses.dayLabel')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((dd) => (
          <Pill key={dd} label={String(dd)} selected={dd === d} onPress={() => pick(y, m, dd)} />
        ))}
      </View>
    </View>
  );
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
  // LUMPER PAYMENTS MISSING FROM THE REPORT (owner decision 2026-09-19) —
  // read-only, used only by the diagnostic panel and the "create missing
  // lumper expense entries" backfill below; never fed into the report's
  // own row list (a reimbursement is never a report row by itself, only
  // the companion deduction it may be missing is).
  const reimbursementsQuery = useReimbursements();
  const insertDeduction = useInsertDeduction();

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const directRows: PrimeDriverExpenseRow[] = useMemo(
    () => (expensesQuery.data ?? []).map((r) => ({ ...r, origin: 'direct' as const })),
    [expensesQuery.data]
  );
  // PRIME LUMPER EXCEPTION (owner decision 2026-09-23) — see
  // eligibleDeductionRowsForReport(). Only lumpers from a settlement whose
  // recorded carrier is a known non-Prime carrier are left out.
  const nonPrimeIds = useMemo(() => nonPrimeSettlementIds(settlementsQuery.data ?? []), [settlementsQuery.data]);
  const deductionRows = useMemo(() => eligibleDeductionRowsForReport(deductionsQuery.data ?? [], nonPrimeIds), [deductionsQuery.data, nonPrimeIds]);
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

  // LUMPER PAYMENTS MISSING FROM THE REPORT — DIAGNOSIS (owner decision
  // 2026-09-19). This repo has no live database access from outside the
  // app itself, so "run the eligibility check against every existing
  // Lumper Fees deduction row" runs HERE, on the user's own device,
  // against their own real rows — diagnoseLumperDeductions() surfaces
  // every deduction that names a lumper (by category OR by description
  // text, catching a category-name mismatch too) with its real
  // source/category/accountant_category and exactly why it's or isn't
  // eligible. findLumperReimbursementGaps() separately surfaces the
  // CONFIRMED root cause this pass fixed going forward: a settlement
  // reimbursement that names a lumper but has no matching out-of-pocket
  // expense row at all (reimbursements have no category column, so this
  // money was previously invisible to this report no matter what).
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const lumperDiagnostics = useMemo(
    () =>
      diagnoseLumperDeductions(
        (deductionsQuery.data ?? []).map((d) => ({
          id: d.id,
          settlement_id: d.settlement_id,
          description: d.description,
          amount: d.amount,
          ded_date: d.ded_date,
          category: d.category,
          source: d.source,
          accountant_category: d.accountant_category,
        })),
        nonPrimeIds
      ),
    [deductionsQuery.data, nonPrimeIds]
  );
  const lumperReimbursementGaps = useMemo(
    () =>
      findLumperReimbursementGaps(
        (reimbursementsQuery.data ?? []).map((r) => ({ id: r.id, settlement_id: r.settlement_id, description: r.description, amount: r.amount, reimb_date: r.reimb_date })),
        (deductionsQuery.data ?? []).map((d) => ({ settlement_id: d.settlement_id, description: d.description, amount: d.amount, ded_date: d.ded_date, category: d.category, source: d.source }))
      ),
    [reimbursementsQuery.data, deductionsQuery.data]
  );

  // LUMPER BANNER (owner decision 2026-09-23) — lists every GENUINELY
  // OUT-OF-POCKET lumper that isn't on the report yet, and adds them with
  // one tap:
  //   - out-of-pocket Lumper Fees deductions with no accountant_category
  //   - reimbursement-section lumpers with no companion expense (and no
  //     withheld lumper advance on the same settlement)
  // A Prime "ADV FOR OUTSIDE LUMPER" line is money Prime fronted and took
  // back — NEVER out-of-pocket. It is never a banner item, never copied
  // onto this report, and never gets an accountant_category (origin rule).
  const uncategorizedLumpers = useMemo(() => {
    const ids = new Set(backfillCandidates.filter((c) => c.accountantCategory === 'Lumpers').map((c) => c.id));
    return (deductionsQuery.data ?? []).filter((d) => ids.has(d.id));
  }, [backfillCandidates, deductionsQuery.data]);
  const lumperBannerItems = useMemo(
    () => [
      ...uncategorizedLumpers.map((d) => ({ key: `u-${d.id}`, kind: 'sourceUncategorized' as const, date: d.ded_date, amount: Number(d.amount ?? 0), description: d.description })),
      ...lumperReimbursementGaps.map((g) => ({ key: `r-${g.reimbursementId}`, kind: 'sourceReimbursement' as const, date: g.date, amount: g.amount, description: g.description })),
    ],
    [uncategorizedLumpers, lumperReimbursementGaps]
  );

  const [addingLumpers, setAddingLumpers] = useState(false);
  async function handleAddAllLumpers() {
    if (!userId) return;
    setAddingLumpers(true);
    try {
      for (const d of uncategorizedLumpers) {
        await updateDeduction.mutateAsync({ id: d.id, values: { accountant_category: 'Lumpers' } });
      }
      for (const gap of lumperReimbursementGaps) {
        await insertDeduction.mutateAsync({
          user_id: userId,
          ded_date: gap.date,
          description: gap.description,
          amount: gap.amount,
          category: 'Lumper Fees',
          source: 'import',
          tax_deductible: true,
          accountant_category: suggestAccountantCategory('Lumper Fees', 'import'),
        });
      }
      await invalidateFinancialData(queryClient, { entities: ['deductions'] });
      // Jump to the earliest month that just received a lumper, so the
      // result is on screen instead of the current (possibly empty) month.
      const firstDate = lumperBannerItems.map((i) => i.date).filter((x): x is string => !!x).sort()[0];
      if (firstDate) showMonthOf(firstDate);
      const { y, m } = parseIsoParts(firstDate ?? todayIso());
      Alert.alert(
        t('primeDriverExpenses.lumperBanner.doneTitle'),
        t('primeDriverExpenses.lumperBanner.doneBody', {
          count: lumperBannerItems.length,
          month: monthLabel(y, m, { year: 'numeric', month: 'long' }),
        })
      );
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setAddingLumpers(false);
    }
  }

  function showMonthOf(iso: string) {
    const { y, m } = parseIsoParts(iso);
    setYear(y);
    setMonth(m);
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
      showMonthOf(addDate || todayIso());
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
  // real Schedule-C category is completely untouched). Amount/note for a
  // deduction-sourced row are managed on Deductions' own screen. The DATE
  // is editable here too (owner decision 2026-09-23) — it writes the same
  // `deductions.ded_date` Deductions shows, never a report-only copy, so
  // both screens always agree on which month the row belongs to.
  async function handleSaveEdit() {
    if (!editingRow || !editCategory || editingRow.origin === 'prime_settlement') return;
    setEditSaving(true);
    try {
      const newDate = editDate || todayIso();
      if (editingRow.origin === 'deduction') {
        await updateDeduction.mutateAsync({
          id: editingRow.id,
          values: {
            accountant_category: editCategory,
            ...(newDate !== editingRow.exp_date ? { ded_date: newDate } : {}),
          },
        });
        await invalidateFinancialData(queryClient, { entities: ['deductions'] });
      } else {
        await updateExpense.mutateAsync({
          id: editingRow.id,
          values: { exp_date: newDate, amount: Number(editAmount) || 0, category: editCategory, note: editNote.trim() || null },
        });
        await invalidateFinancialData(queryClient, { entities: ['prime_driver_expenses'] });
      }
      showMonthOf(newDate);
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
    // A Prime settlement lumper is the real withheld deduction — deleting
    // it here would change true profit/tax everywhere. Never deletable here.
    if (row.origin === 'prime_settlement') return;
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

        {/* LUMPER BANNER (owner decision 2026-09-23) — deliberately at the
            top, above everything else, with every row listed, so it can't
            be missed. Renders whenever any lumper isn't on the report. */}
        {lumperBannerItems.length > 0 && (
          <Card style={{ marginTop: spacing.md, borderColor: colors.orange, borderWidth: 2 }}>
            <Text style={[styles.categoryTitle, { color: colors.orange }]}>
              ⚠️ {t('primeDriverExpenses.lumperBanner.title', { count: lumperBannerItems.length })}
            </Text>
            <MutedText style={{ marginTop: spacing.xs }}>{t('primeDriverExpenses.lumperBanner.body')}</MutedText>
            {lumperBannerItems.map((item) => (
              <View key={item.key} style={styles.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text }}>{item.description ?? ''}</Text>
                  <MutedText style={{ fontSize: typography.size.xs }}>
                    {t(`primeDriverExpenses.lumperBanner.${item.kind}`, { date: item.date ? date(item.date) : '—' })}
                  </MutedText>
                </View>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(item.amount)}</Text>
              </View>
            ))}
            <PrimaryButton
              title={t('primeDriverExpenses.lumperBanner.button', { count: lumperBannerItems.length })}
              onPress={handleAddAllLumpers}
              loading={addingLumpers}
            />
          </Card>
        )}

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

        {/* DIAGNOSTIC PANEL — same "no live database access from this
            environment, so the check has to run on the user's own device
            against their own real rows" pattern this app already uses for
            the Daily Tip diagnostics/Verify Balance breakdown. */}
        <Pressable onPress={() => setShowDiagnostics((v) => !v)} style={{ marginTop: spacing.sm }}>
          <MutedText style={{ fontSize: typography.size.xs }}>
            {showDiagnostics ? '▾ ' : '▸ '}
            {t('primeDriverExpenses.diagnosticsToggle')}
          </MutedText>
        </Pressable>
        {showDiagnostics && (
          <Card style={{ marginTop: spacing.xs, borderColor: colors.accent, borderWidth: 1 }}>
            <Text style={styles.categoryTitle}>{t('primeDriverExpenses.diagnosticsTitle')}</Text>
            {lumperDiagnostics.length === 0 ? (
              <MutedText style={{ marginTop: spacing.xs }}>{t('primeDriverExpenses.diagnosticsNoRows')}</MutedText>
            ) : (
              lumperDiagnostics.map((d) => (
                <View key={d.id} style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                  <Text style={{ color: colors.text }}>
                    {d.ded_date ? date(d.ded_date) : '—'} · {money(Number(d.amount ?? 0))}
                  </Text>
                  {d.description ? <MutedText numberOfLines={1}>{d.description}</MutedText> : null}
                  <MutedText style={{ fontSize: typography.size.xs }}>
                    category: {d.category ?? '(none)'} · source: {d.source ?? '(none)'} · accountant_category: {d.accountant_category ?? '(none)'}
                  </MutedText>
                  <Text style={{ color: d.eligible ? colors.green : colors.orange, fontSize: typography.size.xs, fontWeight: '700' }}>
                    {d.reason === 'eligible' ? t('primeDriverExpenses.diagnosticsEligible') : t(`primeDriverExpenses.diagnosticsReason.${d.reason}`)}
                  </Text>
                </View>
              ))
            )}
            {lumperReimbursementGaps.length > 0 && (
              <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                <MutedText style={{ fontSize: typography.size.xs }}>
                  {t('primeDriverExpenses.diagnosticsGapsNote', { count: lumperReimbursementGaps.length })}
                </MutedText>
              </View>
            )}
          </Card>
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
                        {r.origin === 'prime_settlement' && (
                          <MutedText style={{ color: colors.accent, fontSize: typography.size.xs }}>
                            {t('primeDriverExpenses.fromPrimeSettlement', { date: r.exp_date ? date(r.exp_date) : '' })}
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
        <DatePickerField value={addDate} onChange={setAddDate} />
        <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.amountLabel')}</MutedText>
        <Field value={addAmount} onChangeText={setAddAmount} keyboardType="decimal-pad" placeholder="0.00" />
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
        {editingRow?.origin === 'prime_settlement' ? (
          // PRIME LUMPER EXCEPTION — read-only: this is the real withheld
          // settlement line, shown here only for the accountant. Changing
          // or deleting it would change true profit/tax elsewhere.
          <>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {editingRow.exp_date ? date(editingRow.exp_date) : ''} · {money(Number(editingRow.amount ?? 0))}
            </Text>
            {editingRow.note ? <MutedText>{editingRow.note}</MutedText> : null}
            <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.primeSettlementLumperNote')}</MutedText>
          </>
        ) : (
          <>
            {editingRow?.origin === 'deduction' ? (
              // ITEM 7 — a deduction-sourced row's editor here is the 16-value
              // accountant category picker ONLY: date/amount/note are managed
              // on Deductions' own screen (this report reads them live, never
              // a copy) and the real Schedule-C category is never touched
              // from here.
              <MutedText style={{ marginBottom: spacing.sm }}>{t('primeDriverExpenses.editingDeductionNote')}</MutedText>
            ) : null}
            <MutedText>{t('primeDriverExpenses.dateLabel')}</MutedText>
            <DatePickerField value={editDate} onChange={setEditDate} />
            {editingRow?.origin !== 'deduction' && (
              <>
                <MutedText style={{ marginTop: spacing.sm }}>{t('primeDriverExpenses.amountLabel')}</MutedText>
                <Field value={editAmount} onChangeText={setEditAmount} keyboardType="decimal-pad" placeholder="0.00" />
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
          </>
        )}
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
