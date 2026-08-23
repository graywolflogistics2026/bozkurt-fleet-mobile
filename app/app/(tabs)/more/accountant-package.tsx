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
  type AccountantScope,
  type LineItem,
} from '@/src/stats/accountantPackage';
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

const DISCLAIMER = 'Estimates only — not tax advice. Verify with your CPA.';

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
// PART B) — Year/Month/Scope selectors, origin-tagged out-of-pocket-only
// default scope (src/stats/accountantPackage.ts's ORIGIN RULE), the full
// section order the spec calls for, editable/deletable rows, owner-paid
// highlighting, Capital Assets, and Owner's Equity. The per-category
// Schedule C rollup / income-offset math from the ORIGINAL
// buildAccountantPackage() (still exported, untouched) is superseded here
// by the new line-item-first pipeline (buildLineItems ->
// buildScheduleCTotals/buildLumperFees/buildPerDiemBlock/
// buildCapitalAssets/buildOwnersEquity) so every number on this screen
// traces back to a real, individually editable row.
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
  const headerLine = [companyName, truckLabel].filter(Boolean).join(' — ') || t('accountantPackage.title');

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

  function buildReportHtml(scopeYear: number, scopeMonth: number | null) {
    const items =
      scopeMonth === month && scopeYear === year
        ? lineItems
        : buildLineItems(deductionsQuery.data ?? [], fuelQuery.data ?? [], maintenanceQuery.data ?? [], tollsQuery.data ?? [], scopeYear, scopeMonth, scope);
    const totals = buildScheduleCTotals(items, userCategoriesQuery.data ?? []);
    const total = totals.reduce((sum, c) => sum + c.amount, 0);
    const miscWarningForExport = checkMiscConcentration(totals);
    const lumpers = buildLumperFees(items);
    const periodLabel = scopeMonth == null ? String(scopeYear) : `${scopeYear}-${String(scopeMonth).padStart(2, '0')}`;
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

    const categoryRows = totals
      .map(
        (c) =>
          `<tr><td style="font-weight:700">${c.category}${c.scheduleCLine ? ` (Line ${c.scheduleCLine})` : ''}</td><td style="text-align:right">${money(c.amount)}</td></tr>`
      )
      .join('');
    const lumperRows = lumpers
      .map(
        (l) =>
          `<tr${l.isOwnerPaid ? ' style="background:#fef3c7"' : ''}><td>${l.date ?? ''} — ${l.description}${l.isOwnerPaid ? ' 💰 OWNER PAID' : ''}</td><td style="text-align:right">${money(l.amount)}</td></tr>`
      )
      .join('');
    const assetRows = capitalAssets
      .map((a) => `<tr><td>${a.type} — ${a.name}${a.date ? ` (${date(a.date)})` : ''}</td><td style="text-align:right">${money(a.price)}</td></tr>`)
      .join('');
    const warningRows = implausibleDates
      .map((w) => `<tr><td>${w.label}</td><td>${w.date}</td></tr>`)
      .join('');

    return `
      <html>
        <head><meta charset="utf-8" />
          <style>
            body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; padding: 24px; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            h2 { font-size: 15px; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            td { padding: 6px 0; border-bottom: 1px solid #eee; }
            .total { font-weight: 700; border-top: 2px solid #333; }
            .muted { color: #666; font-size: 11px; margin-top: 24px; }
            .warn { color: #b45309; }
          </style>
        </head>
        <body>
          <h1>${headerLine}</h1>
          <div class="muted">${periodLabel} — ${t(`accountantPackage.scope${scope.charAt(0).toUpperCase()}${scope.slice(1)}`)}</div>

          <table>
            <tr><td style="font-weight:700">${t('accountantPackage.grossIncome')}</td><td style="text-align:right">${money(grossForExport)}</td></tr>
            <tr class="total"><td>${t('accountantPackage.deductibleExpenses')}</td><td style="text-align:right">${money(total)}</td></tr>
          </table>

          ${
            perDiemForExport
              ? `<h2>${t('accountantPackage.perDiemTitle')}</h2><table>
                  <tr><td>${t('accountantPackage.perDiemMonthLabel')}</td><td style="text-align:right">${perDiemForExport.monthDays} ${t('accountantPackage.perDiemDaysUnit')} — ${money(perDiemForExport.monthDeduction)}</td></tr>
                  <tr><td>${t('accountantPackage.perDiemYtdLabel')}</td><td style="text-align:right">${perDiemForExport.ytdDays} ${t('accountantPackage.perDiemDaysUnit')} — ${money(perDiemForExport.ytdDeduction)}</td></tr>
                </table>`
              : ''
          }

          ${
            implausibleDates.length > 0
              ? `<h2 class="warn">${t('accountantPackage.implausibleDateWarning', { count: implausibleDates.length })}</h2><table>${warningRows}</table>`
              : ''
          }

          ${
            miscWarningForExport
              ? `<h2 class="warn">${t('accountantPackage.miscConcentrationWarning', { pct: (miscWarningForExport.miscPct * 100).toFixed(0) })}</h2>`
              : ''
          }

          ${lumpers.length > 0 ? `<h2>${t('accountantPackage.lumperFeesTitle')}</h2><table>${lumperRows}</table>` : ''}

          <h2>${t('accountantPackage.categoryTableTitle')}</h2>
          <table>${categoryRows}<tr class="total"><td>${t('accountantPackage.grandTotal')}</td><td style="text-align:right">${money(total)}</td></tr></table>

          <h2>${t('accountantPackage.capitalAssetsTitle')}</h2>
          <table>${assetRows || `<tr><td>${t('accountantPackage.noCapitalAssets')}</td><td></td></tr>`}</table>

          <h2>${t('accountantPackage.ownersEquityTitle')}</h2>
          <table>
            <tr><td>${t('accountantPackage.cashTransfers')}</td><td style="text-align:right">${money(ownersEquity.cashAmount)}</td></tr>
            <tr><td>${t('accountantPackage.paidPersonally')}</td><td style="text-align:right">${money(ownersEquity.linkedAmount)}</td></tr>
          </table>

          <p class="muted">${t('accountantPackage.perDiemNote')}<br/>${t('accountantPackage.capitalAssetsNote')}<br/>${DISCLAIMER}</p>
        </body>
      </html>
    `;
  }

  async function handleExportPdf(scopeMonth: number | null) {
    const key = scopeMonth == null ? 'pdfYear' : 'pdfMonth';
    setExporting(key);
    try {
      const html = buildReportHtml(year, scopeMonth);
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
      const html = buildReportHtml(year, scopeMonth);
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
              <Row label={t('accountantPackage.grossIncome')} value={money(grossIncome)} bold />
              {reimbursementsTotal > 0 && (
                <MutedText>{t('accountantPackage.reimbursementsSubline', { amount: money(reimbursementsTotal) })}</MutedText>
              )}
              <View style={styles.rowBorder}>
                <Row label={t('accountantPackage.deductibleExpenses')} value={money(totalExpenses)} bold />
              </View>
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
                <Text style={styles.sectionTitle}>{t('accountantPackage.lumperFeesTitle')}</Text>
                <Card>
                  {lumperFees.map((item, i) => (
                    <LineItemRow key={item.id} item={item} isFirst={i === 0} onEdit={() => openEdit(item)} onDelete={() => handleDeleteItem(item)} money={money} />
                  ))}
                  <View style={styles.rowBorder}>
                    <Row label={t('accountantPackage.totalExpenses')} value={money(lumperTotal)} bold />
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
                  {[...scheduleCTotals]
                    .sort((a, b) => b.amount - a.amount)
                    .map((cat) => {
                      // Group by the SAME resolved Schedule C bucket
                      // buildScheduleCTotals() itself used — a custom
                      // category's raw name (e.g. "Detention Software")
                      // can resolve to a DIFFERENT bucket ("ELD &
                      // Communications"), so comparing against the raw
                      // `li.category` here would silently drop those rows
                      // from the list while still counting them in the total.
                      const rowsForCategory = lineItems.filter(
                        (li) => resolveScheduleCBucket(li.category, userCategoriesQuery.data ?? []) === cat.category
                      );
                      return (
                        <View key={cat.category} style={{ marginBottom: spacing.sm }}>
                          <View style={styles.categoryHeaderRow}>
                            <Text style={styles.categoryHeaderText} numberOfLines={1}>
                              {cat.category}
                              {cat.scheduleCLine ? ` (${t('accountantPackage.line')} ${cat.scheduleCLine})` : ''}
                            </Text>
                            <Text style={styles.categoryHeaderAmount}>{money(cat.amount)}</Text>
                          </View>
                          {rowsForCategory.map((item, i) => (
                            <LineItemRow key={item.id} item={item} isFirst={i === 0} onEdit={() => openEdit(item)} onDelete={() => handleDeleteItem(item)} money={money} />
                          ))}
                        </View>
                      );
                    })}
                  <View style={styles.rowBorder}>
                    <Row label={t('accountantPackage.grandTotal')} value={money(totalExpenses)} bold />
                  </View>
                </>
              )}
            </Card>

            <Text style={styles.sectionTitle}>{t('accountantPackage.capitalAssetsTitle')}</Text>
            <MutedText>{t('accountantPackage.capitalAssetsNote')}</MutedText>
            <Card>
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
              <Row label={t('accountantPackage.cashTransfers')} value={`${money(ownersEquity.cashAmount)} (${ownersEquity.cashCount})`} />
              <View style={styles.rowBorder}>
                <Row label={t('accountantPackage.paidPersonally')} value={`${money(ownersEquity.linkedAmount)} (${ownersEquity.linkedCount})`} />
              </View>
              <View style={styles.rowBorder}>
                <Row label={t('accountantPackage.totalExpenses')} value={money(ownersEquity.total)} bold />
              </View>
              {ownersEquity.unmatchedOwnerPaidCount > 0 && (
                <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>
                  ⚠️ {t('accountantPackage.unmatchedOwnerPaidWarning', { count: ownersEquity.unmatchedOwnerPaidCount })}
                </MutedText>
              )}
            </Card>
            <MutedText>{t('accountantPackage.ownersEquityNote')}</MutedText>

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
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  lineItemRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  ownerPaidRow: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
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
  },
  categoryHeaderText: {
    flex: 1,
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '800' as const,
  },
  categoryHeaderAmount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '800' as const,
  },
};
