import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions, useUpdateDeduction, useDeleteDeduction, useInsertDeduction } from '@/src/data/deductions';
import { useFuelPurchases, useDeleteFuelPurchase } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords, useDeleteMaintenanceRecord } from '@/src/data/maintenanceRecords';
import { useTolls, useDeleteToll } from '@/src/data/tolls';
import { useReimbursements } from '@/src/data/reimbursements';
import { useTrucksList } from '@/src/data/trucks';
import { useEquipment } from '@/src/data/equipment';
import { useCapitalTransactions } from '@/src/data/capitalTransactions';
import { useUserCategories } from '@/src/data/userCategories';
import { useLearnCategoryCorrection } from '@/src/data/categoryLearningRules';
import { useTaxYearData } from '@/src/data/taxYearData';
import { useAuth } from '@/src/context/AuthContext';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import {
  buildLineItems,
  buildScheduleCTotals,
  checkMiscConcentration,
  buildLumperFees,
  buildPerDiemBlock,
  buildCapitalAssets,
  buildOwnersEquity,
  groupLineItemsByScheduleCBucket,
  type AccountantScope,
  type LineItem,
} from '@/src/stats/accountantPackage';
import { buildAccountantReportHtml, type AccountantReportStrings, type AccountantReportInput } from '@/src/stats/accountantPackageReport';
import { ACCOUNTANT_SCREEN_COLORS } from '@/src/stats/accountantPackageColors';
import { resolveScheduleCBucket } from '@/src/stats/profitLoss';
import { findImplausibleDates } from '@/src/import/dateGuard';
import { CategoryPicker } from '@/src/components/CategoryPicker';
import { useFormatters } from '@/src/i18n/format';
import {
  Screen,
  ScreenTitle,
  Card,
  MutedText,
  LegalFootnote,
  PrimaryButton,
  SecondaryButton,
  ModalSheet,
  SheetTitle,
} from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { DeductionInsert } from '@/src/types/db';

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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={bold ? styles.rowLabelBold : styles.rowLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: bold ? '700' : '600' }}>{value}</Text>
    </View>
  );
}

// FULL VISUAL PARITY WITH WEB (owner decision, v2026.08.05-W chase, item 1
// "BLUE — Capital Assets section... and the Schedule C reference chips") —
// the small blue pill shown beside a category's own Schedule C line
// reference, on-screen equivalent of the exported HTML's own `.chip` CSS
// class (accountantPackageReport.ts) — same colour token
// (ACCOUNTANT_SCREEN_COLORS.capitalAssetsHeaderBg), so the chip reads as
// the same visual language wherever a Schedule C line is referenced.
function ScheduleCChip({ line }: { line: string | null }) {
  const { t } = useTranslation();
  if (!line) return null;
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>
        {t('accountantPackage.line')} {line}
      </Text>
    </View>
  );
}

function convertLineItemToDeductionInsert(item: LineItem, userId: string, newCategory: string): DeductionInsert {
  return {
    user_id: userId,
    ded_date: item.date,
    description: item.description,
    amount: item.amount,
    category: newCategory,
    source: 'manual',
    tax_deductible: true,
  };
}

// ACCOUNTANT PACKAGE REWORK (owner decision 2026-08-05, FULL PARITY pass
// PART B; visual rework owner decision, v2026.08.05-W chase — FULL
// VISUAL PARITY WITH WEB) — Year/Month/Scope selectors, origin-tagged
// out-of-pocket-only default scope (src/stats/accountantPackage.ts's
// ORIGIN RULE), the full section order the spec calls for, editable/
// deletable rows, owner-paid highlighting, Capital Assets, and Owner's
// Equity. The per-category Schedule C rollup / income-offset math from
// the ORIGINAL buildAccountantPackage() (still exported, untouched) is
// superseded here by the line-item-first pipeline (buildLineItems ->
// buildScheduleCTotals/buildLumperFees/buildPerDiemBlock/
// buildCapitalAssets/buildOwnersEquity) so every number on this screen
// traces back to a real, individually editable row. The VISUAL layer
// (colour coding, Schedule C chips, the owner-equity four-flow summary,
// the reconciling caption, the full header identity string) now matches
// the web report exactly — accountantPackageColors.ts/
// accountantPackageReport.ts are the shared, tested source of truth every
// one of the three surfaces (screen/PDF/Excel) reads from.
export default function AccountantPackage() {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const queryClient = useQueryClient();
  const { session, profile } = useAuth();
  const userId = session?.user.id;

  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const reimbursementsQuery = useReimbursements();
  const trucksQuery = useTrucksList();
  const equipmentQuery = useEquipment();
  const contributionsQuery = useCapitalTransactions();
  const userCategoriesQuery = useUserCategories({ active: true });
  const taxYearDataQuery = useTaxYearData();

  const updateDeduction = useUpdateDeduction();
  const learnCategoryCorrection = useLearnCategoryCorrection();
  const deleteDeduction = useDeleteDeduction();
  const insertDeduction = useInsertDeduction();
  const deleteFuel = useDeleteFuelPurchase();
  const deleteMaintenance = useDeleteMaintenanceRecord();
  const deleteToll = useDeleteToll();

  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | null>(now.getMonth() + 1);
  const [scope, setScope] = useState<AccountantScope>('outOfPocket');

  const [editingItem, setEditingItem] = useState<LineItem | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }

  const availableYears = useMemo(() => {
    const years = new Set<number>([now.getFullYear()]);
    for (const s of settlementsQuery.data ?? []) {
      const y = Number((s.week_ending ?? '').slice(0, 4));
      if (Number.isFinite(y) && y > 0) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }, [settlementsQuery.data]);

  const loading =
    settlementsQuery.isLoading ||
    deductionsQuery.isLoading ||
    fuelQuery.isLoading ||
    maintenanceQuery.isLoading ||
    tollsQuery.isLoading ||
    reimbursementsQuery.isLoading ||
    taxYearDataQuery.isLoading;

  const lineItems = useMemo(
    () =>
      buildLineItems(
        deductionsQuery.data ?? [],
        fuelQuery.data ?? [],
        maintenanceQuery.data ?? [],
        tollsQuery.data ?? [],
        year,
        month,
        scope
      ),
    [deductionsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data, year, month, scope]
  );

  const scheduleCTotals = useMemo(
    () => buildScheduleCTotals(lineItems, userCategoriesQuery.data ?? []),
    [lineItems, userCategoriesQuery.data]
  );
  const totalExpenses = scheduleCTotals.reduce((sum, c) => sum + c.amount, 0);
  // MISC CONCENTRATION WARNING (owner decision 2026-08-05, FULL PARITY
  // follow-up item H.1) — informational only, never blocks anything.
  const miscWarning = useMemo(() => checkMiscConcentration(scheduleCTotals), [scheduleCTotals]);
  const lumperFees = useMemo(() => buildLumperFees(lineItems), [lineItems]);
  const lumperTotal = lumperFees.reduce((sum, i) => sum + i.amount, 0);
  // Shared by BOTH the on-screen category table and the exported HTML —
  // the two can never disagree about how rows are grouped (see this
  // helper's own header comment in accountantPackage.ts for the exact
  // bug this fixed originally).
  const groupedCategories = useMemo(
    () => groupLineItemsByScheduleCBucket(lineItems, scheduleCTotals, userCategoriesQuery.data ?? []),
    [lineItems, scheduleCTotals, userCategoriesQuery.data]
  );

  const perDiemBlock = useMemo(() => {
    if (!taxYearDataQuery.data) return null;
    return buildPerDiemBlock(settlementsQuery.data ?? [], year, month, taxYearDataQuery.data.data.per_diem);
  }, [settlementsQuery.data, year, month, taxYearDataQuery.data]);

  const capitalAssets = useMemo(
    () => buildCapitalAssets(trucksQuery.data ?? [], equipmentQuery.data ?? []),
    [trucksQuery.data, equipmentQuery.data]
  );

  const ownersEquity = useMemo(
    () => buildOwnersEquity(contributionsQuery.data ?? [], lineItems),
    [contributionsQuery.data, lineItems]
  );

  const grossIncome = useMemo(() => {
    const inWindow = (settlementsQuery.data ?? []).filter((s) => {
      const y = Number((s.week_ending ?? '').slice(0, 4));
      if (y !== year) return false;
      if (month == null) return true;
      return Number((s.week_ending ?? '').slice(5, 7)) === month;
    });
    return inWindow.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  }, [settlementsQuery.data, year, month]);

  const reimbursementsTotal = useMemo(() => {
    // Reimbursements have no origin-scope concept of their own (they're
    // always carrier-paid-back money) — shown as a sub-line under gross
    // income regardless of scope, matching the spec's "gross income with
    // a '+ $X reimbursements' sub-line" (item B.2).
    const inWindow = (reimbursementsQuery.data ?? []).filter((r) => {
      const y = Number((r.reimb_date ?? '').slice(0, 4));
      if (y !== year) return false;
      if (month == null) return true;
      return Number((r.reimb_date ?? '').slice(5, 7)) === month;
    });
    return inWindow.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  }, [reimbursementsQuery.data, year, month]);

  const implausibleDates = useMemo(() => {
    const rows: { label: string; date: string }[] = [];
    for (const d of findImplausibleDates(deductionsQuery.data ?? [], (r) => r.ded_date))
      rows.push({ label: d.description || d.category || 'Deduction', date: d.ded_date ?? '' });
    for (const f of findImplausibleDates(fuelQuery.data ?? [], (r) => r.purchase_date))
      rows.push({ label: f.location || 'Fuel', date: f.purchase_date ?? '' });
    for (const m of findImplausibleDates(maintenanceQuery.data ?? [], (r) => r.service_date))
      rows.push({ label: m.description || m.service_type || 'Maintenance', date: m.service_date ?? '' });
    for (const toll of findImplausibleDates(tollsQuery.data ?? [], (r) => r.toll_date))
      rows.push({ label: toll.plaza || 'Toll', date: toll.toll_date ?? '' });
    return rows;
  }, [deductionsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]);

  const companyName = profile?.company_name?.trim() || null;
  const activeTruck = (trucksQuery.data ?? []).find((tr) => tr.is_active) ?? (trucksQuery.data ?? [])[0] ?? null;
  const truckLabel = activeTruck
    ? [activeTruck.unit_number ? `Unit ${activeTruck.unit_number}` : null, [activeTruck.year, activeTruck.make, activeTruck.model].filter(Boolean).join(' ') || null]
        .filter(Boolean)
        .join(' · ')
    : null;

  // HEADER IDENTITY (spec item 3: "company name — truck unit — period —
  // scope, exactly as the web header renders it") — ONE shared builder so
  // the on-screen title and every export's own header line are always
  // built the exact same way, from the exact same four segments, in the
  // exact same order.
  function periodLabelFor(scopeYear: number, scopeMonth: number | null): string {
    return scopeMonth == null ? String(scopeYear) : date(`${scopeYear}-${String(scopeMonth).padStart(2, '0')}-01`, { year: 'numeric', month: 'long' });
  }
  function scopeLabelFor(s: AccountantScope): string {
    return t(`accountantPackage.scope${s.charAt(0).toUpperCase()}${s.slice(1)}`);
  }
  function buildHeaderLine(scopeYear: number, scopeMonth: number | null): string {
    return [companyName, truckLabel, periodLabelFor(scopeYear, scopeMonth), scopeLabelFor(scope)].filter(Boolean).join(' — ');
  }
  const headerLine = buildHeaderLine(year, month);

  function openEdit(item: LineItem) {
    setEditingItem(item);
    setEditCategory(item.category);
  }

  async function handleSaveCategory() {
    if (!editingItem || !userId) return;
    setSavingEdit(true);
    try {
      if (editingItem.kind === 'deduction') {
        await updateDeduction.mutateAsync({ id: editingItem.id, values: { category: editCategory } });
      } else {
        // Spec item B.4: changing a fuel/maintenance/toll row's category
        // converts it into a deduction row so the new category sticks —
        // delete the original typed row, insert a new manual deduction.
        const insert = convertLineItemToDeductionInsert(editingItem, userId, editCategory);
        await insertDeduction.mutateAsync(insert);
        if (editingItem.kind === 'fuel') await deleteFuel.mutateAsync(editingItem.id);
        else if (editingItem.kind === 'maintenance') await deleteMaintenance.mutateAsync(editingItem.id);
        else if (editingItem.kind === 'toll') await deleteToll.mutateAsync(editingItem.id);
      }
      // CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
      // follow-up item G) — best-effort, never blocks the save.
      if (editCategory && editCategory !== editingItem.category) {
        learnCategoryCorrection.mutate({ userId, description: editingItem.description, category: editCategory });
      }
      await invalidateFinancialData(queryClient);
      setEditingItem(null);
    } catch (err) {
      Alert.alert(t('accountantPackage.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSavingEdit(false);
    }
  }

  function handleDeleteItem(item: LineItem) {
    Alert.alert(t('accountantPackage.deleteRowConfirmTitle'), t('accountantPackage.deleteRowConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            if (item.kind === 'deduction') await deleteDeduction.mutateAsync(item.id);
            else if (item.kind === 'fuel') await deleteFuel.mutateAsync(item.id);
            else if (item.kind === 'maintenance') await deleteMaintenance.mutateAsync(item.id);
            else if (item.kind === 'toll') await deleteToll.mutateAsync(item.id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('accountantPackage.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  // FULL VISUAL PARITY WITH WEB — every string the shared, pure
  // accountantPackageReport.ts needs, resolved via t() here (this
  // component is the one place that's allowed to call t() — the report
  // builder itself is a plain, framework-free function, same "pure
  // function, caller owns i18n via t()" convention as every other
  // presentation module in this app).
  function buildBaseReportStrings(): Omit<AccountantReportStrings, 'reimbursementsSubline' | 'implausibleDateWarning' | 'miscConcentrationWarning'> {
    return {
      grossIncome: t('accountantPackage.grossIncome'),
      deductibleExpenses: t('accountantPackage.deductibleExpenses'),
      reconcilingCaption: t('accountantPackage.reconcilingCaption'),
      perDiemTitle: t('accountantPackage.perDiemTitle'),
      perDiemMonthLabel: t('accountantPackage.perDiemMonthLabel'),
      perDiemYtdLabel: t('accountantPackage.perDiemYtdLabel'),
      perDiemDaysUnit: t('accountantPackage.perDiemDaysUnit'),
      perDiemNote: t('accountantPackage.perDiemNote'),
      lumperFeesTitle: t('accountantPackage.lumperFeesTitle'),
      paidWithLabel: t('accountantPackage.paidWithLabel'),
      categoryTableTitle: t('accountantPackage.categoryTableTitle'),
      lineLabel: t('accountantPackage.line'),
      grandTotal: t('accountantPackage.grandTotal'),
      ownerPaidBadge: t('accountantPackage.ownerPaidBadge'),
      capitalAssetsTitle: t('accountantPackage.capitalAssetsTitle'),
      capitalAssetsNote: t('accountantPackage.capitalAssetsNote'),
      noCapitalAssets: t('accountantPackage.noCapitalAssets'),
      financingCash: t('accountantPackage.financingCash'),
      financingLoan: t('accountantPackage.financingLoan'),
      ownersEquityTitle: t('accountantPackage.ownersEquityTitle'),
      cashContributedLabel: t('accountantPackage.cashContributedLabel'),
      cashContributedNote: t('accountantPackage.cashContributedNote'),
      expensesPaidPersonallyLabel: t('accountantPackage.expensesPaidPersonallyLabel'),
      expensesPaidPersonallyNote: t('accountantPackage.expensesPaidPersonallyNote'),
      reimbursementsTakenBackLabel: t('accountantPackage.reimbursementsTakenBackLabel'),
      reimbursementsTakenBackNote: t('accountantPackage.reimbursementsTakenBackNote'),
      ownerDrawsLabel: t('accountantPackage.ownerDrawsLabel'),
      ownerDrawsNote: t('accountantPackage.ownerDrawsNote'),
      netPositionLabel: t('accountantPackage.netPositionLabel'),
      footerMealsNote: t('accountantPackage.footerMealsNote'),
      footerNonDeductibleNote: t('accountantPackage.footerNonDeductibleNote'),
      footerOwnerPaidNote: t('accountantPackage.footerOwnerPaidNote'),
      disclaimer: t('common.legalFootnote'),
    };
  }

  function buildReportInput(scopeYear: number, scopeMonth: number | null): { input: AccountantReportInput; strings: AccountantReportStrings } {
    const items =
      scopeMonth === month && scopeYear === year
        ? lineItems
        : buildLineItems(deductionsQuery.data ?? [], fuelQuery.data ?? [], maintenanceQuery.data ?? [], tollsQuery.data ?? [], scopeYear, scopeMonth, scope);
    const totals = buildScheduleCTotals(items, userCategoriesQuery.data ?? []);
    const total = totals.reduce((sum, c) => sum + c.amount, 0);
    const miscWarningForExport = checkMiscConcentration(totals);
    const lumpers = buildLumperFees(items);
    const lumperTotalForExport = lumpers.reduce((sum, i) => sum + i.amount, 0);
    const grouped = groupLineItemsByScheduleCBucket(items, totals, userCategoriesQuery.data ?? []);
    const perDiemForExport =
      taxYearDataQuery.data && (scopeYear !== year || scopeMonth !== month)
        ? buildPerDiemBlock(settlementsQuery.data ?? [], scopeYear, scopeMonth, taxYearDataQuery.data.data.per_diem)
        : perDiemBlock;
    const grossForExport =
      scopeYear === year && scopeMonth === month
        ? grossIncome
        : (settlementsQuery.data ?? [])
            .filter((s) => {
              const y = Number((s.week_ending ?? '').slice(0, 4));
              if (y !== scopeYear) return false;
              if (scopeMonth == null) return true;
              return Number((s.week_ending ?? '').slice(5, 7)) === scopeMonth;
            })
            .reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const reimbursementsForExport =
      scopeYear === year && scopeMonth === month
        ? reimbursementsTotal
        : (reimbursementsQuery.data ?? [])
            .filter((r) => {
              const y = Number((r.reimb_date ?? '').slice(0, 4));
              if (y !== scopeYear) return false;
              if (scopeMonth == null) return true;
              return Number((r.reimb_date ?? '').slice(5, 7)) === scopeMonth;
            })
            .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

    const strings: AccountantReportStrings = {
      ...buildBaseReportStrings(),
      reimbursementsSubline:
        reimbursementsForExport > 0 ? t('accountantPackage.reimbursementsSubline', { amount: money(reimbursementsForExport) }) : undefined,
      implausibleDateWarning:
        implausibleDates.length > 0 ? t('accountantPackage.implausibleDateWarning', { count: implausibleDates.length }) : undefined,
      miscConcentrationWarning: miscWarningForExport
        ? t('accountantPackage.miscConcentrationWarning', { pct: (miscWarningForExport.miscPct * 100).toFixed(0) })
        : undefined,
    };

    const input: AccountantReportInput = {
      headerLine: buildHeaderLine(scopeYear, scopeMonth),
      grossIncome: grossForExport,
      reimbursementsTotal: reimbursementsForExport,
      totalExpenses: total,
      perDiem: perDiemForExport,
      implausibleDates,
      miscWarning: miscWarningForExport,
      lumperFees: lumpers,
      lumperTotal: lumperTotalForExport,
      groupedCategories: grouped,
      capitalAssets,
      ownersEquity,
    };

    return { input, strings };
  }

  async function handleExportPdf(scopeMonth: number | null) {
    const key = scopeMonth == null ? 'pdfYear' : 'pdfMonth';
    setExporting(key);
    try {
      const { input, strings } = buildReportInput(year, scopeMonth);
      const html = buildAccountantReportHtml(input, strings, { money, date });
      const { uri } = await Print.printToFileAsync({ html });
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(t('accountantPackage.shareNotAvailable'));
        return;
      }
      await Sharing.shareAsync(uri);
    } catch (err) {
      Alert.alert(t('accountantPackage.exportFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setExporting(null);
    }
  }

  async function handleExportExcel(scopeMonth: number | null) {
    const key = scopeMonth == null ? 'excelYear' : 'excelMonth';
    setExporting(key);
    try {
      const { input, strings } = buildReportInput(year, scopeMonth);
      const html = buildAccountantReportHtml(input, strings, { money, date });
      const filename = scopeMonth == null ? `accountant-package-${year}.xls` : `accountant-package-${year}-${String(scopeMonth).padStart(2, '0')}.xls`;
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

  const monthNames = Array.from({ length: 12 }, (_, i) => date(`${year}-${String(i + 1).padStart(2, '0')}-01`, { month: 'short' }));
  const flows = ownersEquity.flows;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <ScreenTitle>{headerLine}</ScreenTitle>
        <MutedText>{t('accountantPackage.subtitle')}</MutedText>

        <Text style={styles.sectionTitle}>{t('accountantPackage.yearLabel')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {availableYears.map((y) => (
            <Pill key={y} label={String(y)} selected={year === y} onPress={() => setYear(y)} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t('accountantPackage.monthLabel')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Pill label={t('accountantPackage.allYear')} selected={month == null} onPress={() => setMonth(null)} />
          {monthNames.map((label, i) => (
            <Pill key={i} label={label} selected={month === i + 1} onPress={() => setMonth(i + 1)} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t('accountantPackage.scopeLabel')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Pill label={t('accountantPackage.scopeOutOfPocket')} selected={scope === 'outOfPocket'} onPress={() => setScope('outOfPocket')} />
          <Pill label={t('accountantPackage.scopeWithheld')} selected={scope === 'withheld'} onPress={() => setScope('withheld')} />
          <Pill label={t('accountantPackage.scopeCombined')} selected={scope === 'combined'} onPress={() => setScope('combined')} />
        </View>
        {scope === 'outOfPocket' && <MutedText>{t('accountantPackage.scopeOutOfPocketNote')}</MutedText>}

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            <Card>
              <View style={[styles.tintedRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.grossIncomeBg }]}>
                <Row label={t('accountantPackage.grossIncome')} value={money(grossIncome)} bold />
              </View>
              {reimbursementsTotal > 0 && (
                <MutedText>{t('accountantPackage.reimbursementsSubline', { amount: money(reimbursementsTotal) })}</MutedText>
              )}
              <View style={[styles.rowBorder, styles.tintedRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.totalRowBg }]}>
                <Row label={t('accountantPackage.deductibleExpenses')} value={money(totalExpenses)} bold />
              </View>
              <MutedText>{t('accountantPackage.reconcilingCaption')}</MutedText>
              {perDiemBlock && (
                <View style={styles.rowBorder}>
                  <Row label={t('accountantPackage.perDiemMonthLabel')} value={money(perDiemBlock.monthDeduction)} />
                </View>
              )}
            </Card>

            {perDiemBlock && (
              <>
                <Text style={styles.sectionTitle}>{t('accountantPackage.perDiemTitle')}</Text>
                <Card>
                  <Row label={t('accountantPackage.perDiemMonthLabel')} value={`${perDiemBlock.monthDays} ${t('accountantPackage.perDiemDaysUnit')} — ${money(perDiemBlock.monthDeduction)}`} />
                  <View style={styles.rowBorder}>
                    <Row label={t('accountantPackage.perDiemYtdLabel')} value={`${perDiemBlock.ytdDays} ${t('accountantPackage.perDiemDaysUnit')} — ${money(perDiemBlock.ytdDeduction)}`} />
                  </View>
                </Card>
                <MutedText>{t('accountantPackage.perDiemNote')}</MutedText>
              </>
            )}

            {implausibleDates.length > 0 && (
              <Card>
                <MutedText style={{ color: colors.red }}>
                  ⚠️ {t('accountantPackage.implausibleDateWarning', { count: implausibleDates.length })}
                </MutedText>
              </Card>
            )}

            {miscWarning && (
              <Card>
                <MutedText style={{ color: colors.orange }}>
                  ⚠️ {t('accountantPackage.miscConcentrationWarning', { pct: Math.round(miscWarning.miscPct * 100) })}
                </MutedText>
              </Card>
            )}

            {lumperFees.length > 0 && (
              <>
                <View style={[styles.sectionHeaderTint, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.lumperHeaderBg }]}>
                  <Text style={styles.sectionTitleOnTint}>{t('accountantPackage.lumperFeesTitle')}</Text>
                </View>
                <Card>
                  {lumperFees.map((item, i) => (
                    <LineItemRow key={item.id} item={item} isFirst={i === 0} onEdit={() => openEdit(item)} onDelete={() => handleDeleteItem(item)} money={money} />
                  ))}
                  <View style={styles.rowBorder}>
                    <Row label={t('accountantPackage.grandTotal')} value={money(lumperTotal)} bold />
                  </View>
                </Card>
              </>
            )}

            <Text style={styles.sectionTitle}>{t('accountantPackage.categoryTableTitle')}</Text>
            <Card>
              {lineItems.length === 0 ? (
                <MutedText>{t('accountantPackage.noExpenses')}</MutedText>
              ) : (
                <>
                  {groupedCategories.map((cat) => (
                    <View key={cat.category} style={{ marginBottom: spacing.sm }}>
                      <View style={[styles.categoryHeaderRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.subtotalRowBg }]}>
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                          <Text style={styles.categoryHeaderText} numberOfLines={1}>
                            {cat.category}
                          </Text>
                          <ScheduleCChip line={cat.scheduleCLine} />
                        </View>
                        <Text style={styles.categoryHeaderAmount}>{money(cat.amount)}</Text>
                      </View>
                      {cat.items.map((item, i) => (
                        <LineItemRow key={item.id} item={item} isFirst={i === 0} onEdit={() => openEdit(item)} onDelete={() => handleDeleteItem(item)} money={money} />
                      ))}
                    </View>
                  ))}
                  <View style={[styles.rowBorder, styles.tintedRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.totalRowBg }]}>
                    <Row label={t('accountantPackage.grandTotal')} value={money(totalExpenses)} bold />
                  </View>
                </>
              )}
            </Card>

            <View style={[styles.sectionHeaderTint, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.capitalAssetsHeaderBg }]}>
              <Text style={styles.sectionTitleOnTint}>{t('accountantPackage.capitalAssetsTitle')}</Text>
            </View>
            <MutedText>{t('accountantPackage.capitalAssetsNote')}</MutedText>
            <Card style={{ backgroundColor: ACCOUNTANT_SCREEN_COLORS.capitalAssetsBg }}>
              {capitalAssets.length === 0 ? (
                <MutedText>{t('accountantPackage.noCapitalAssets')}</MutedText>
              ) : (
                capitalAssets.map((a, i) => (
                  <View key={`${a.type}-${a.name}-${i}`} style={i > 0 ? styles.rowBorder : undefined}>
                    <Row
                      label={`${a.name}${a.date ? ` — ${date(a.date)}` : ''} (${a.financing === 'loan' ? t('accountantPackage.financingLoan') : t('accountantPackage.financingCash')})`}
                      value={money(a.price)}
                    />
                  </View>
                ))
              )}
            </Card>

            <Text style={styles.sectionTitle}>{t('accountantPackage.ownersEquityTitle')}</Text>
            <Card>
              <View style={[styles.tintedRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.contributionsInBg }]}>
                <Row label={`${t('accountantPackage.cashContributedLabel')} (${flows.cashContributedCount})`} value={money(flows.cashContributed)} />
              </View>
              <MutedText>{t('accountantPackage.cashContributedNote')}</MutedText>

              <View style={[styles.rowBorder, styles.tintedRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.contributionsInBg }]}>
                <Row
                  label={`${t('accountantPackage.expensesPaidPersonallyLabel')} (${flows.expensesPaidPersonallyOutstandingCount})`}
                  value={money(flows.expensesPaidPersonallyOutstanding)}
                />
              </View>
              <MutedText>{t('accountantPackage.expensesPaidPersonallyNote')}</MutedText>

              <View style={[styles.rowBorder, styles.tintedRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.drawsOutBg }]}>
                <Row label={`${t('accountantPackage.reimbursementsTakenBackLabel')} (${flows.reimbursementsTakenBackCount})`} value={`-${money(flows.reimbursementsTakenBack)}`} />
              </View>
              <MutedText>{t('accountantPackage.reimbursementsTakenBackNote')}</MutedText>

              <View style={[styles.rowBorder, styles.tintedRow, { backgroundColor: ACCOUNTANT_SCREEN_COLORS.drawsOutBg }]}>
                <Row label={`${t('accountantPackage.ownerDrawsLabel')} (${flows.ownerDrawsCount})`} value={`-${money(flows.ownerDraws)}`} />
              </View>
              <MutedText>{t('accountantPackage.ownerDrawsNote')}</MutedText>

              <View style={styles.rowBorder}>
                <Row label={t('accountantPackage.netPositionLabel')} value={money(flows.netPosition)} bold />
              </View>
              {ownersEquity.unmatchedOwnerPaidCount > 0 && (
                <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>
                  ⚠️ {t('accountantPackage.unmatchedOwnerPaidWarning', { count: ownersEquity.unmatchedOwnerPaidCount })}
                </MutedText>
              )}
            </Card>
            <MutedText>{t('accountantPackage.ownersEquityNote')}</MutedText>
            <MutedText>{t('accountantPackage.footerMealsNote')}</MutedText>
            <MutedText>{t('accountantPackage.footerNonDeductibleNote')}</MutedText>
            <MutedText>{t('accountantPackage.footerOwnerPaidNote')}</MutedText>

            <Text style={styles.sectionTitle}>{t('accountantPackage.exportTitle')}</Text>
            <Card>
              <PrimaryButton title={`📄 ${t('accountantPackage.exportPdfMonth')}`} onPress={() => handleExportPdf(month)} loading={exporting === 'pdfMonth'} />
              <SecondaryButton title={`📄 ${t('accountantPackage.exportPdfYear')}`} onPress={() => handleExportPdf(null)} loading={exporting === 'pdfYear'} />
              <SecondaryButton title={`📊 ${t('accountantPackage.exportExcelMonth')}`} onPress={() => handleExportExcel(month)} loading={exporting === 'excelMonth'} />
              <SecondaryButton title={`📊 ${t('accountantPackage.exportExcelYear')}`} onPress={() => handleExportExcel(null)} loading={exporting === 'excelYear'} />
            </Card>
            <LegalFootnote />
          </>
        )}
      </ScrollView>

      <ModalSheet visible={!!editingItem} onClose={() => setEditingItem(null)}>
        <SheetTitle>{t('accountantPackage.editRow')}</SheetTitle>
        {editingItem && <MutedText>{editingItem.description}</MutedText>}
        <CategoryPicker kind="expense" value={editCategory} onChange={setEditCategory} />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveCategory} loading={savingEdit} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setEditingItem(null)} />
      </ModalSheet>
    </Screen>
  );
}

function LineItemRow({
  item,
  isFirst,
  onEdit,
  onDelete,
  money,
}: {
  item: LineItem;
  isFirst: boolean;
  onEdit: () => void;
  onDelete: () => void;
  money: (n: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.lineItemRow, !isFirst && styles.rowBorder, item.isOwnerPaid && styles.ownerPaidRow]}>
      <Pressable style={{ flex: 1 }} onPress={onEdit}>
        <Text style={styles.rowLabel} numberOfLines={2}>
          {item.date ?? ''} — {item.description}
          {item.isOwnerPaid ? ` 💰 ${t('accountantPackage.ownerPaidBadge')}` : ''}
        </Text>
        {/* "Paid with" column (spec item 1) — an actual grid column in the
            PDF/Excel export (accountantPackageReport.ts); on a narrow
            phone screen the same information is shown inline under the
            row instead of as a separate column, to avoid overflow. */}
        {item.isOwnerPaid && item.paymentMethod && (
          <MutedText>{t('accountantPackage.paidWithLabel')}: {item.paymentMethod}</MutedText>
        )}
      </Pressable>
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600', marginStart: spacing.sm }}>{money(item.amount)}</Text>
      <Pressable onPress={onDelete} hitSlop={8} style={{ marginStart: spacing.sm }}>
        <Text style={{ color: colors.red, fontWeight: '700' }}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  // FULL VISUAL PARITY WITH WEB — a colour-tinted section header (Lumper
  // Fees amber, Capital Assets blue) replacing a plain sectionTitle Text
  // wherever the spec calls for a coloured header band.
  sectionHeaderTint: {
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionTitleOnTint: {
    color: '#111',
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  // A tinted row's own horizontal padding — a plain `row` has none since
  // it normally sits flush inside its Card, but a coloured background
  // needs breathing room on both sides to read as a deliberate highlight
  // rather than a clipped edge-to-edge smear.
  tintedRow: {
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  lineItemRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  ownerPaidRow: {
    backgroundColor: ACCOUNTANT_SCREEN_COLORS.ownerPaidBg,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: {
    flex: 1,
    color: colors.text,
    fontSize: typography.size.sm,
    marginEnd: spacing.sm,
  },
  rowLabelBold: {
    flex: 1,
    color: colors.muted,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginEnd: spacing.sm,
  },
  categoryHeaderRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  categoryHeaderText: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '800' as const,
    marginEnd: spacing.xs,
  },
  categoryHeaderAmount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '800' as const,
  },
  chip: {
    backgroundColor: ACCOUNTANT_SCREEN_COLORS.capitalAssetsHeaderBg,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  chipText: {
    color: colors.accent,
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
  },
};
