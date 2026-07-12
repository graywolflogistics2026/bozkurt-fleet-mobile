import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useLoanRows } from '@/src/data/loans';
import { useDocuments } from '@/src/data/documents';
import { useUserCategories } from '@/src/data/userCategories';
import { useTaxYearData } from '@/src/data/taxYearData';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildAccountantPackage } from '@/src/stats/accountantPackage';
import { calcPerDiemDays, calcPerDiemDeduction } from '@/src/tax/perDiem';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, LegalFootnote, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { ExtractedRevenueItem } from '@/src/import/types';

const DISCLAIMER = 'Estimates only — not tax advice. Verify with your CPA.';

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={bold ? styles.rowLabelBold : styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: bold ? '700' : '600' }}>{value}</Text>
    </View>
  );
}

// Accountant Package export (PROMPTS.md Session 9b item 3) — the per-
// category Schedule C rollup (deductions + maintenance_records +
// fuel_purchases + loan-interest-estimate, reimbursement-vs-income offset
// applied) lives in src/stats/accountantPackage.ts (pure, unit-tested);
// this screen is just the data-fetching/rendering/export shell around it.
// Settlement revenueItems are read straight from documents.parsed_json at
// export time (docs/INDUSTRY_TAXONOMY.md's "Wiring status" — no dedicated
// persisted table, same decision Settlements' own detail screen already
// made in Session 9a).
export default function AccountantPackage() {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const queryClient = useQueryClient();

  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const maintenanceQuery = useMaintenanceRecords();
  const fuelQuery = useFuelPurchases();
  const loansQuery = useLoanRows();
  const documentsQuery = useDocuments();
  const userCategoriesQuery = useUserCategories({ active: true });
  const taxYearDataQuery = useTaxYearData();

  const [refreshing, setRefreshing] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loading =
    settlementsQuery.isLoading ||
    deductionsQuery.isLoading ||
    maintenanceQuery.isLoading ||
    fuelQuery.isLoading ||
    loansQuery.isLoading ||
    documentsQuery.isLoading ||
    taxYearDataQuery.isLoading;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }

  const revenueItems = useMemo(() => {
    const items: ExtractedRevenueItem[] = [];
    for (const doc of documentsQuery.data ?? []) {
      if (doc.doc_type !== 'settlement') continue;
      const parsed = doc.parsed_json as { settlement?: { revenueItems?: ExtractedRevenueItem[] } } | null;
      const lines = parsed?.settlement?.revenueItems;
      if (Array.isArray(lines)) items.push(...lines);
    }
    return items;
  }, [documentsQuery.data]);

  const rollup = useMemo(() => {
    if (!taxYearDataQuery.data) return null;
    const settlements = settlementsQuery.data ?? [];
    const perDiemDays = calcPerDiemDays(settlements);
    const perDiemDeduction = calcPerDiemDeduction(perDiemDays, taxYearDataQuery.data.data.per_diem);
    return buildAccountantPackage(
      deductionsQuery.data ?? [],
      maintenanceQuery.data ?? [],
      fuelQuery.data ?? [],
      loansQuery.data ?? [],
      revenueItems,
      userCategoriesQuery.data ?? [],
      perDiemDays,
      perDiemDeduction
    );
  }, [
    taxYearDataQuery.data,
    settlementsQuery.data,
    deductionsQuery.data,
    maintenanceQuery.data,
    fuelQuery.data,
    loansQuery.data,
    revenueItems,
    userCategoriesQuery.data,
  ]);

  async function handleExportJson() {
    if (!rollup) return;
    setExportingJson(true);
    try {
      const payload = {
        generatedAt: new Date().toISOString(),
        disclaimer: DISCLAIMER,
        scheduleC: rollup.scheduleC,
        totalExpenses: rollup.totalExpenses,
        income: rollup.income,
        perDiem: rollup.perDiem,
      };
      const file = new File(Paths.cache, 'accountant-package.json');
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(payload, null, 2));

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(t('accountantPackage.shareNotAvailable'));
        return;
      }
      await Sharing.shareAsync(file.uri);
    } catch (err) {
      Alert.alert(t('accountantPackage.exportFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setExportingJson(false);
    }
  }

  async function handleExportPdf() {
    if (!rollup) return;
    setExportingPdf(true);
    try {
      const rows = rollup.scheduleC
        .map((c) => `<tr><td>${c.category}</td><td style="text-align:right">${money(c.amount)}</td></tr>`)
        .join('');
      const incomeRows = rollup.income.byType
        .map((c) => `<tr><td>${c.category.replace(/_/g, ' ')}</td><td style="text-align:right">${money(c.amount)}</td></tr>`)
        .join('');
      const html = `
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
            </style>
          </head>
          <body>
            <h1>${t('accountantPackage.title')}</h1>
            <div class="muted">${t('accountantPackage.generatedOn', { date: date(new Date().toISOString().slice(0, 10)) })}</div>

            <h2>${t('accountantPackage.scheduleCTitle')}</h2>
            <table>${rows}<tr class="total"><td>${t('accountantPackage.totalExpenses')}</td><td style="text-align:right">${money(rollup.totalExpenses)}</td></tr></table>

            <h2>${t('accountantPackage.incomeTitle')}</h2>
            <table>${incomeRows || `<tr><td>${t('accountantPackage.noOtherIncome')}</td><td></td></tr>`}<tr class="total"><td>${t('accountantPackage.totalOtherIncome')}</td><td style="text-align:right">${money(rollup.income.total)}</td></tr></table>

            <h2>${t('accountantPackage.perDiemTitle')}</h2>
            <table>
              <tr><td>${t('accountantPackage.perDiemDays')}</td><td style="text-align:right">${rollup.perDiem.days}</td></tr>
              <tr><td>${t('accountantPackage.perDiemDeduction')}</td><td style="text-align:right">${money(rollup.perDiem.deduction)}</td></tr>
            </table>

            <p class="muted">${DISCLAIMER}</p>
          </body>
        </html>
      `;
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
      setExportingPdf(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <ScreenTitle>{t('accountantPackage.title')}</ScreenTitle>
        <MutedText>{t('accountantPackage.subtitle')}</MutedText>

        {loading || !rollup ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('accountantPackage.scheduleCTitle')}</Text>
            <Card>
              {rollup.scheduleC.length === 0 ? (
                <MutedText>{t('accountantPackage.noExpenses')}</MutedText>
              ) : (
                <>
                  {rollup.scheduleC.map((c, i) => (
                    <View key={c.category} style={i > 0 ? styles.rowBorder : undefined}>
                      <Row label={c.category} value={money(c.amount)} />
                    </View>
                  ))}
                  <View style={styles.rowBorder}>
                    <Row label={t('accountantPackage.totalExpenses')} value={money(rollup.totalExpenses)} bold />
                  </View>
                </>
              )}
            </Card>

            <Text style={styles.sectionTitle}>{t('accountantPackage.incomeTitle')}</Text>
            <MutedText>{t('accountantPackage.incomeSubtitle')}</MutedText>
            <Card>
              {rollup.income.byType.length === 0 ? (
                <MutedText>{t('accountantPackage.noOtherIncome')}</MutedText>
              ) : (
                <>
                  {rollup.income.byType.map((c, i) => (
                    <View key={c.category} style={i > 0 ? styles.rowBorder : undefined}>
                      <Row label={c.category.replace(/_/g, ' ')} value={money(c.amount)} />
                    </View>
                  ))}
                  <View style={styles.rowBorder}>
                    <Row label={t('accountantPackage.totalOtherIncome')} value={money(rollup.income.total)} bold />
                  </View>
                </>
              )}
            </Card>

            <Text style={styles.sectionTitle}>{t('accountantPackage.perDiemTitle')}</Text>
            <Card>
              <Row label={t('accountantPackage.perDiemDays')} value={String(rollup.perDiem.days)} />
              <View style={styles.rowBorder}>
                <Row label={t('accountantPackage.perDiemDeduction')} value={money(rollup.perDiem.deduction)} />
              </View>
            </Card>

            <Text style={styles.sectionTitle}>{t('accountantPackage.exportTitle')}</Text>
            <Card>
              <PrimaryButton title={`📄 ${t('accountantPackage.exportPdf')}`} onPress={handleExportPdf} loading={exportingPdf} />
              <SecondaryButton title={`{ } ${t('accountantPackage.exportJson')}`} onPress={handleExportJson} />
              {exportingJson && <MutedText style={{ marginTop: spacing.xs }}>{t('common.loading')}</MutedText>}
            </Card>
            <LegalFootnote />
          </>
        )}
      </ScrollView>
    </Screen>
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
};
