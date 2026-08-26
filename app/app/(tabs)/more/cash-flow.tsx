import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useLoads } from '@/src/data/loads';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useDeductions } from '@/src/data/deductions';
import { useTolls } from '@/src/data/tolls';
import { useReimbursements } from '@/src/data/reimbursements';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useDocuments } from '@/src/data/documents';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildWeeklyTrend, rankLoadsByRpm, type RankedLoad } from '@/src/stats/cashFlowTrend';
import {
  buildCashFlowForecastFromData,
  buildSpendEvents,
  buildPeriodicItemsInRange,
  buildDocumentAmountLookup,
  type CashFlowOverrides,
  type CashFlowWeekProjection,
} from '@/src/stats/cashFlowForecast';
import { buildMonthlyCashFlowOverview, findTightestMonthIndex, findBestMonthIndex, type CashFlowMonthProjection } from '@/src/stats/cashFlowMonthly';
import { buildPolylinePoints, buildAreaPoints } from '@/src/stats/chartHelpers';
import { useFormatters } from '@/src/i18n/format';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// CASH FLOW MONTHLY VIEW (owner decision, "period tabs" pass) — a wide,
// fixed lookback/lookahead window for the full-history inputs the Monthly
// engine needs (buildSpendEvents/buildPeriodicItemsInRange normally take an
// explicit range; the 30-day forecast above windows them to ~12 weeks,
// which is correct for THAT engine but would silently blank out any month
// more than 12 weeks in the past). Not a real date bound — just wide enough
// that no real account data ever falls outside it.
const MONTHLY_ALL_TIME_START_ISO = '2000-01-01';
const MONTHLY_ALL_TIME_END_ISO = '2100-12-31';

const CHART_HEIGHT = 120;

// Clean-product fix (owner decision 2026-07-30): the tax reserve % is the
// ONE field allowed to show 25 as a labeled SUGGESTION — it is never
// applied unless the user actually enters it.
const TAX_RESERVE_SUGGESTED_PCT = '25';

// Thin-line "Apple Stocks style" trend chart — unchanged by this pass.
function WeeklyTrendChart({ points }: { points: ReturnType<typeof buildWeeklyTrend> }) {
  const { money } = useFormatters();
  const [width, setWidth] = useState(0);
  const height = CHART_HEIGHT;

  const grossValues = points.map((p) => p.gross);
  const netValues = points.map((p) => p.net);
  const domain: [number, number] = [
    Math.min(0, ...grossValues, ...netValues),
    Math.max(0, ...grossValues, ...netValues),
  ];
  const grossLine = buildPolylinePoints(grossValues, width, height, domain);
  const netLine = buildPolylinePoints(netValues, width, height, domain);
  const netArea = width > 0 && netValues.length >= 2 ? buildAreaPoints(netLine, width, height) : '';
  const netIsPositive = (netValues[netValues.length - 1] ?? 0) >= 0;
  const netColor = netIsPositive ? colors.green : colors.red;
  const netFill = netIsPositive ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';

  return (
    <View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {points.length >= 2 && width > 0 && (
          <Svg width={width} height={height}>
            <Polygon points={netArea} fill={netFill} stroke="none" />
            <Polyline points={grossLine} fill="none" stroke={colors.accent} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            <Polyline points={netLine} fill="none" stroke={netColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <MutedText>{points[0]?.weekEnding}</MutedText>
        <MutedText>{points[points.length - 1]?.weekEnding}</MutedText>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 2, backgroundColor: colors.accent }} />
          <MutedText>{`Gross · ${money(Math.max(0, ...grossValues))} max`}</MutedText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 2, backgroundColor: netColor }} />
          <MutedText>Net</MutedText>
        </View>
      </View>
    </View>
  );
}

// Same visual pill accountant-package.tsx already established for its own
// Year/Month/Scope selectors — reused here (screen-local, not promoted to
// ui.tsx, matching that screen's own precedent) for period tabs + the year
// selector.
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

// A thin single-line "Apple Stocks style" trend of closing balance across
// however many months are passed in — same buildPolylinePoints/
// buildAreaPoints primitive as WeeklyTrendChart (CLAUDE.md's CHART
// LANGUAGE CONSISTENCY invariant), colored by the LAST month's sign.
function MonthlyTrendChart({ months }: { months: CashFlowMonthProjection[] }) {
  const { monthLabel: monthLabelFmt } = useFormatters();
  const [width, setWidth] = useState(0);
  const height = CHART_HEIGHT;

  const values = months.map((m) => m.closingBalance);
  const domain: [number, number] = [Math.min(0, ...values), Math.max(0, ...values)];
  const line = buildPolylinePoints(values, width, height, domain);
  const area = width > 0 && values.length >= 2 ? buildAreaPoints(line, width, height) : '';
  const isPositive = (values[values.length - 1] ?? 0) >= 0;
  const color = isPositive ? colors.green : colors.red;
  const fill = isPositive ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
  // MONTH FILTER OFF-BY-ONE fix (owner decision) — was
  // `date(new Date(Date.UTC(...)).toISOString()..., ...)`, the same UTC-
  // midnight-parsed-then-local-rendered mismatch as the Accountant
  // Package's own bug (src/i18n/format.ts's formatMonthLabel() header
  // comment has the full root-cause writeup). This label was informational
  // only (chart axis endpoints, never a selector), so it never caused the
  // WRONG data to load — only ever showed the wrong month NAME.
  const monthLabel = (m: CashFlowMonthProjection) => monthLabelFmt(m.year, m.month, { month: 'short' });

  return (
    <View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {months.length >= 2 && width > 0 && (
          <Svg width={width} height={height}>
            <Polygon points={area} fill={fill} stroke="none" />
            <Polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <MutedText>{months[0] ? monthLabel(months[0]) : ''}</MutedText>
        <MutedText>{months[months.length - 1] ? monthLabel(months[months.length - 1]) : ''}</MutedText>
      </View>
    </View>
  );
}

// One row per month — actuals for a fully-past month, a blended figure for
// the month "today" falls in, a steady-state projection for a future
// month, dimmed with a "Projected" label per the spec ("clearly
// distinguished"). Collapsed by default; tapping opens the same
// opening/income/fixed/variable/periodic/closing breakdown WeekCard
// already shows for the 30-day view (spec item 4, "same breakdown...
// keeping the 'where it came from' basis and manual overrides" — the
// figures here already reflect whatever income/fixed/variable/periodic
// overrides are set, since they're computed from the exact same
// forecast.weeklyIncome/weeklyFixed/weeklyVariable/overrides the 30-day
// view uses).
function MonthCard({
  m,
  expanded,
  onToggle,
  isTightest,
  isBest,
}: {
  m: CashFlowMonthProjection;
  expanded: boolean;
  onToggle: () => void;
  isTightest: boolean;
  isBest: boolean;
}) {
  const { t } = useTranslation();
  const { money, monthLabel: monthLabelFmt } = useFormatters();
  // MONTH FILTER OFF-BY-ONE fix (owner decision) — see
  // src/i18n/format.ts's formatMonthLabel() for the full root-cause
  // writeup (the same UTC-midnight-vs-local-render mismatch as the
  // Accountant Package's own bug).
  const monthLabel = monthLabelFmt(m.year, m.month, { year: 'numeric', month: 'long' });
  const dimmed = m.status === 'projected';

  return (
    <Pressable onPress={onToggle}>
      <Card
        style={{
          ...(isTightest ? { borderColor: colors.orange, borderWidth: 1 } : isBest ? { borderColor: colors.green, borderWidth: 1 } : {}),
          ...(dimmed ? { opacity: 0.65 } : {}),
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{monthLabel}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
            {m.status === 'projected' && (
              <Text style={{ color: colors.muted, fontSize: typography.size.xs, fontWeight: '700' }}>{t('cashFlowScreen.monthProjectedBadge')}</Text>
            )}
            {m.status === 'current' && (
              <Text style={{ color: colors.accent, fontSize: typography.size.xs, fontWeight: '700' }}>{t('cashFlowScreen.monthCurrentBadge')}</Text>
            )}
            {isTightest && <Text style={{ color: colors.orange, fontSize: typography.size.xs, fontWeight: '700' }}>{t('cashFlowScreen.monthTightestBadge')}</Text>}
            {isBest && <Text style={{ color: colors.green, fontSize: typography.size.xs, fontWeight: '700' }}>{t('cashFlowScreen.monthBestBadge')}</Text>}
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
          <MutedText>{t('cashFlowScreen.endingBalanceLabel')}</MutedText>
          <Text style={{ color: m.closingBalance >= 0 ? colors.green : colors.red, fontWeight: '700' }}>{money(m.closingBalance)}</Text>
        </View>

        {expanded && (
          <View style={{ marginTop: spacing.xs, gap: 2 }}>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.openingBalanceLabel')}</MutedText>
              <Text style={{ color: colors.text }}>{money(m.openingBalance)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.incomeLabel')}</MutedText>
              <Text style={{ color: colors.green }}>+{money(m.income)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.fixedLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money(m.fixed)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.variableLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money(m.variable)}</Text>
            </View>
            {m.periodic > 0 && (
              <View style={styles.forecastRow}>
                <MutedText>{t('cashFlowScreen.periodicLabel')}</MutedText>
                <Text style={{ color: colors.red }}>-{money(m.periodic)}</Text>
              </View>
            )}
            {m.periodicItems.map((p) => (
              <MutedText key={p.id} style={{ marginStart: spacing.sm }}>
                • {p.label}
              </MutedText>
            ))}
            <View style={[styles.forecastRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs, marginTop: spacing.xs }]}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{t('cashFlowScreen.endingBalanceLabel')}</Text>
              <Text style={{ color: m.closingBalance >= 0 ? colors.green : colors.red, fontWeight: '700' }}>{money(m.closingBalance)}</Text>
            </View>
          </View>
        )}
      </Card>
    </Pressable>
  );
}

function LaneRow({ l, good }: { l: RankedLoad; good: boolean }) {
  const { money, number } = useFormatters();
  return (
    <View style={styles.laneRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.laneDesc} numberOfLines={1}>
          {l.origin ?? '?'} → {l.destination ?? '?'}
        </Text>
        <MutedText>
          {l.order_number ?? '—'} · {number(l.loaded_miles)} mi · {money(l.revenue)}
        </MutedText>
      </View>
      <Text style={{ color: good ? colors.green : colors.red, fontWeight: '700', fontSize: typography.size.md }}>
        {money(l.rpm, { maximumFractionDigits: 2 })}/mi
      </Text>
    </View>
  );
}

// BUILT FROM THE USER'S OWN DATA (owner decision) — one shared row for
// each of the forecast's three weekly figures (Income/Fixed/Variable):
// shows the CURRENT computed (or overridden) value plus its basis
// caption, with a tap-to-edit affordance that opens an inline Field
// rather than a whole modal — matching the same lightweight "edit in
// place" spirit the old AutoFillField already established for this
// screen, just now driving a real persisted override instead of a form
// field with no computed backing.
function OverridableStat({
  label,
  value,
  basisCaption,
  isOverridden,
  editing,
  draft,
  onStartEdit,
  onChangeDraft,
  onSave,
  onCancel,
  onReset,
  saving,
}: {
  label: string;
  value: number;
  basisCaption: string;
  isOverridden: boolean;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onChangeDraft: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  return (
    <View style={styles.overridableRow}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <MutedText>{label}</MutedText>
        {!editing && (
          <Text style={styles.statValue}>
            {money(value)}
            {t('cashFlowScreen.perWeekSuffix')}
          </Text>
        )}
      </View>
      {editing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Field keyboardType="numeric" value={draft} onChangeText={onChangeDraft} placeholder="0" autoFocus />
          </View>
          <SecondaryButton title={t('common.cancel')} onPress={onCancel} />
          <PrimaryButton title={t('common.save')} onPress={onSave} loading={saving} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <MutedText>{basisCaption}</MutedText>
          {isOverridden ? (
            <Pressable onPress={onReset} hitSlop={8}>
              <Text style={{ color: colors.accent, fontSize: typography.size.xs }}>{t('cashFlowScreen.resetToAverage')}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onStartEdit} hitSlop={8}>
              <Text style={{ color: colors.accent, fontSize: typography.size.xs }}>{t('cashFlowScreen.editValue')}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function WeekCard({
  week,
  isTightest,
}: {
  week: CashFlowWeekProjection;
  isTightest: boolean;
}) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  return (
    <Card style={isTightest ? { borderColor: colors.orange, borderWidth: 1 } : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>
          {date(week.startDate, { month: 'short', day: 'numeric' })} – {date(week.endDate, { month: 'short', day: 'numeric' })}
        </Text>
        {isTightest && <Text style={{ color: colors.orange, fontSize: typography.size.xs, fontWeight: '700' }}>{t('cashFlowScreen.tightestBadge')}</Text>}
      </View>
      <View style={{ marginTop: spacing.xs, gap: 2 }}>
        <View style={styles.forecastRow}>
          <MutedText>{t('cashFlowScreen.openingBalanceLabel')}</MutedText>
          <Text style={{ color: colors.text }}>{money(week.openingBalance)}</Text>
        </View>
        <View style={styles.forecastRow}>
          <MutedText>{t('cashFlowScreen.incomeLabel')}</MutedText>
          <Text style={{ color: colors.green }}>+{money(week.income)}</Text>
        </View>
        <View style={styles.forecastRow}>
          <MutedText>{t('cashFlowScreen.fixedLabel')}</MutedText>
          <Text style={{ color: colors.red }}>-{money(week.fixed)}</Text>
        </View>
        <View style={styles.forecastRow}>
          <MutedText>{t('cashFlowScreen.variableLabel')}</MutedText>
          <Text style={{ color: colors.red }}>-{money(week.variable)}</Text>
        </View>
        {week.periodic > 0 && (
          <View style={styles.forecastRow}>
            <MutedText>{t('cashFlowScreen.periodicLabel')}</MutedText>
            <Text style={{ color: colors.red }}>-{money(week.periodic)}</Text>
          </View>
        )}
        {week.periodicItems.map((p) => (
          <MutedText key={p.id} style={{ marginStart: spacing.sm }}>
            • {p.label}
          </MutedText>
        ))}
        <View style={[styles.forecastRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs, marginTop: spacing.xs }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('cashFlowScreen.endingBalanceLabel')}</Text>
          <Text style={{ color: week.closingBalance >= 0 ? colors.green : colors.red, fontWeight: '700' }}>{money(week.closingBalance)}</Text>
        </View>
      </View>
    </Card>
  );
}

const OVERRIDE_FIELDS = ['income', 'fixed', 'variable'] as const;
type OverrideField = (typeof OVERRIDE_FIELDS)[number];

const CASH_FLOW_PERIODS = ['30days', 'thisMonth', 'monthly'] as const;
type CashFlowPeriod = (typeof CASH_FLOW_PERIODS)[number];

export default function CashFlow() {
  const { t } = useTranslation();
  const { money, date, monthLabel } = useFormatters();
  const settlementsQuery = useSettlements();
  const loadsQuery = useLoads();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const deductionsQuery = useDeductions();
  const tollsQuery = useTolls();
  const reimbursementsQuery = useReimbursements();
  const complianceItemsQuery = useComplianceItems();
  const documentsQuery = useDocuments();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [bankBalanceDraft, setBankBalanceDraft] = useState<string | null>(null);
  const [taxReservePctDraft, setTaxReservePctDraft] = useState<string | null>(null);

  const [editingOverride, setEditingOverride] = useState<OverrideField | null>(null);
  const [overrideDraft, setOverrideDraft] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [periodicDrafts, setPeriodicDrafts] = useState<Record<string, string>>({});
  const [savingPeriodicId, setSavingPeriodicId] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const [period, setPeriod] = useState<CashFlowPeriod>('30days');
  const [monthlyYear, setMonthlyYear] = useState(now.getFullYear());
  const [expandedMonthKey, setExpandedMonthKey] = useState<string | null>(null);

  const bankBalance = bankBalanceDraft ?? (profileQuery.data?.cf_bank_balance != null ? String(profileQuery.data.cf_bank_balance) : '');
  const taxReservePct = taxReservePctDraft ?? (profileQuery.data?.cf_tax_reserve_pct != null ? String(profileQuery.data.cf_tax_reserve_pct) : '');

  const overrides: CashFlowOverrides = useMemo(
    () => ({
      incomeWeekly: profileQuery.data?.cf_income_override ?? null,
      fixedWeekly: profileQuery.data?.cf_fixed_override ?? null,
      variableWeekly: profileQuery.data?.cf_variable_override ?? null,
      periodicAmounts: profileQuery.data?.cf_periodic_overrides ?? {},
    }),
    [profileQuery.data]
  );

  const forecast = useMemo(
    () =>
      buildCashFlowForecastFromData({
        bankBalance: bankBalance ? Number(bankBalance) : 0,
        settlements: settlementsQuery.data ?? [],
        deductions: deductionsQuery.data ?? [],
        fuelPurchases: fuelQuery.data ?? [],
        maintenanceRecords: maintenanceQuery.data ?? [],
        tolls: tollsQuery.data ?? [],
        reimbursements: reimbursementsQuery.data ?? [],
        complianceItems: complianceItemsQuery.data ?? [],
        documents: documentsQuery.data ?? [],
        overrides,
      }),
    [bankBalance, settlementsQuery.data, deductionsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data, reimbursementsQuery.data, complianceItemsQuery.data, documentsQuery.data, overrides]
  );

  // Same income/fixed/variable weekly figures + classification + overrides
  // the 30-day forecast above already computed — the Monthly engine only
  // needs full-history (not 12-week-windowed) events/settlements/periodic
  // items on top of that, since an "actual" month can be far older than
  // the 30-day forecast's own lookback.
  const monthlySharedInput = useMemo(
    () => ({
      todayBalance: bankBalance ? Number(bankBalance) : 0,
      weeklyIncome: forecast.weeklyIncome,
      weeklyFixed: forecast.weeklyFixed,
      weeklyVariable: forecast.weeklyVariable,
      classification: forecast.classification,
      allEvents: buildSpendEvents(
        deductionsQuery.data ?? [],
        fuelQuery.data ?? [],
        maintenanceQuery.data ?? [],
        tollsQuery.data ?? [],
        MONTHLY_ALL_TIME_START_ISO
      ),
      allSettlements: settlementsQuery.data ?? [],
      periodicItems: buildPeriodicItemsInRange(
        complianceItemsQuery.data ?? [],
        buildDocumentAmountLookup(documentsQuery.data ?? []),
        MONTHLY_ALL_TIME_START_ISO,
        MONTHLY_ALL_TIME_END_ISO
      ),
      overrides,
      today: now,
    }),
    [bankBalance, forecast, deductionsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data, settlementsQuery.data, complianceItemsQuery.data, documentsQuery.data, overrides, now]
  );

  const availableYears = useMemo(() => {
    const years = new Set<number>([now.getFullYear()]);
    for (const s of settlementsQuery.data ?? []) {
      const y = Number((s.week_ending ?? '').slice(0, 4));
      if (Number.isFinite(y) && y > 0) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }, [settlementsQuery.data, now]);

  const monthlyOverview = useMemo(
    () => buildMonthlyCashFlowOverview({ year: monthlyYear, ...monthlySharedInput }),
    [monthlyYear, monthlySharedInput]
  );

  const currentYearNow = now.getFullYear();
  const currentMonthNow = now.getMonth() + 1;
  const thisMonthMonths = useMemo(
    () => (monthlyYear === currentYearNow ? monthlyOverview : buildMonthlyCashFlowOverview({ year: currentYearNow, ...monthlySharedInput })),
    [monthlyYear, currentYearNow, monthlyOverview, monthlySharedInput]
  );
  const thisMonthEntry = thisMonthMonths.find((m) => m.month === currentMonthNow);

  const tightestMonthIdx = findTightestMonthIndex(monthlyOverview);
  const bestMonthIdx = findBestMonthIndex(monthlyOverview);

  async function handleSaveBudget() {
    setSavingBudget(true);
    try {
      await updateProfile.mutateAsync({
        cf_bank_balance: bankBalance ? Number(bankBalance) : null,
        cf_tax_reserve_pct: taxReservePct ? Number(taxReservePct) : null,
      });
    } finally {
      setSavingBudget(false);
    }
  }

  function startEditOverride(field: OverrideField, current: number) {
    setEditingOverride(field);
    setOverrideDraft(current ? String(Math.round(current * 100) / 100) : '');
  }

  async function saveOverride(field: OverrideField) {
    setSavingOverride(true);
    try {
      const val = overrideDraft ? Number(overrideDraft) : null;
      const column = field === 'income' ? 'cf_income_override' : field === 'fixed' ? 'cf_fixed_override' : 'cf_variable_override';
      await updateProfile.mutateAsync({ [column]: val } as Record<string, number | null>);
      setEditingOverride(null);
    } finally {
      setSavingOverride(false);
    }
  }

  async function resetOverride(field: OverrideField) {
    const column = field === 'income' ? 'cf_income_override' : field === 'fixed' ? 'cf_fixed_override' : 'cf_variable_override';
    await updateProfile.mutateAsync({ [column]: null } as Record<string, number | null>);
  }

  async function savePeriodicAmount(itemId: string) {
    setSavingPeriodicId(itemId);
    try {
      const draft = periodicDrafts[itemId];
      const val = draft ? Number(draft) : null;
      const nextMap = { ...(profileQuery.data?.cf_periodic_overrides ?? {}) };
      if (val == null) delete nextMap[itemId];
      else nextMap[itemId] = val;
      await updateProfile.mutateAsync({ cf_periodic_overrides: nextMap });
    } finally {
      setSavingPeriodicId(null);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const loading = settlementsQuery.isLoading || loadsQuery.isLoading;
  const trend = useMemo(() => buildWeeklyTrend(settlementsQuery.data ?? []), [settlementsQuery.data]);
  const lanes = useMemo(() => rankLoadsByRpm(loadsQuery.data ?? []), [loadsQuery.data]);
  const hasSettlements = (settlementsQuery.data ?? []).length > 0;

  const tightestWeek = forecast.weeks[forecast.tightestWeekIndex];
  const tightestWeekLabel = tightestWeek ? date(tightestWeek.endDate, { month: 'short', day: 'numeric' }) : '';
  const tightestReasonItem = tightestWeek?.periodicItems[0];
  const oneOffTotal = forecast.classification.oneOffs.reduce((sum, o) => sum + o.amount, 0);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('cashFlowScreen.title')}</ScreenTitle>
        <FleetScopeLabel variant="fleetOnly" />

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : !hasSettlements ? (
          <Card>
            <MutedText>{t('cashFlowScreen.empty')}</MutedText>
          </Card>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('cashFlowScreen.forecastTitle')}</Text>
            <MutedText>{t('cashFlowScreen.forecastSubtitle')}</MutedText>

            {!forecast.reliable && (
              <Card style={{ borderColor: colors.orange, borderWidth: 1 }}>
                <MutedText style={{ color: colors.orange }}>
                  ⏳ {t('cashFlowScreen.reliabilityBanner', { count: forecast.weeksOfHistory })}
                </MutedText>
              </Card>
            )}

            <Card>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <MutedText>{t('cashFlowScreen.bankBalanceLabel')}</MutedText>
                  <Field keyboardType="numeric" value={bankBalance} onChangeText={setBankBalanceDraft} placeholder="0" />
                </View>
                <View style={{ flex: 1 }}>
                  <MutedText>{t('cashFlowScreen.taxReservePctLabel')}</MutedText>
                  <Field keyboardType="numeric" value={taxReservePct} onChangeText={setTaxReservePctDraft} placeholder="0" />
                  <MutedText>{t('cashFlowScreen.taxReservePctSuggestion', { pct: TAX_RESERVE_SUGGESTED_PCT })}</MutedText>
                </View>
              </View>
              <PrimaryButton title={`💾 ${t('cashFlowScreen.saveBudget')}`} onPress={handleSaveBudget} loading={savingBudget} />
            </Card>

            <Text style={styles.sectionTitle}>{t('cashFlowScreen.weeklyAssumptionsTitle')}</Text>
            <Card>
              <OverridableStat
                label={t('cashFlowScreen.incomeLabel')}
                value={forecast.weeklyIncome}
                basisCaption={
                  forecast.incomeIsOverridden
                    ? t('cashFlowScreen.basisManual')
                    : t('cashFlowScreen.basisAvgWeeks', { count: forecast.incomeWeeksFound })
                }
                isOverridden={forecast.incomeIsOverridden}
                editing={editingOverride === 'income'}
                draft={overrideDraft}
                onStartEdit={() => startEditOverride('income', forecast.weeklyIncome)}
                onChangeDraft={setOverrideDraft}
                onSave={() => saveOverride('income')}
                onCancel={() => setEditingOverride(null)}
                onReset={() => resetOverride('income')}
                saving={savingOverride}
              />
              <View style={styles.rowBorder}>
                <OverridableStat
                  label={t('cashFlowScreen.fixedLabel')}
                  value={forecast.weeklyFixed}
                  basisCaption={
                    forecast.fixedIsOverridden
                      ? t('cashFlowScreen.basisManual')
                      : t('cashFlowScreen.basisFixedCount', { count: forecast.classification.fixed.length })
                  }
                  isOverridden={forecast.fixedIsOverridden}
                  editing={editingOverride === 'fixed'}
                  draft={overrideDraft}
                  onStartEdit={() => startEditOverride('fixed', forecast.weeklyFixed)}
                  onChangeDraft={setOverrideDraft}
                  onSave={() => saveOverride('fixed')}
                  onCancel={() => setEditingOverride(null)}
                  onReset={() => resetOverride('fixed')}
                  saving={savingOverride}
                />
              </View>
              <View style={styles.rowBorder}>
                <OverridableStat
                  label={t('cashFlowScreen.variableLabel')}
                  value={forecast.weeklyVariable}
                  basisCaption={
                    forecast.variableIsOverridden
                      ? t('cashFlowScreen.basisManual')
                      : t('cashFlowScreen.basisPerMile', {
                          rate: money(forecast.variableRatePerMile, { maximumFractionDigits: 2 }),
                          miles: Math.round(forecast.variableMilesAvg),
                        })
                  }
                  isOverridden={forecast.variableIsOverridden}
                  editing={editingOverride === 'variable'}
                  draft={overrideDraft}
                  onStartEdit={() => startEditOverride('variable', forecast.weeklyVariable)}
                  onChangeDraft={setOverrideDraft}
                  onSave={() => saveOverride('variable')}
                  onCancel={() => setEditingOverride(null)}
                  onReset={() => resetOverride('variable')}
                  saving={savingOverride}
                />
              </View>
            </Card>

            {forecast.classification.fixed.length > 0 && (
              <>
                <Text style={styles.laneSectionTitle}>{t('cashFlowScreen.fixedChargesTitle')}</Text>
                <Card>
                  {forecast.classification.fixed.map((f, i) => (
                    <View key={f.category} style={[styles.forecastRow, i > 0 ? styles.rowBorder : undefined]}>
                      <MutedText>
                        {f.category} · {t('cashFlowScreen.fixedChargeOccurrence', { occurrences: f.occurrences, weeks: forecast.classification.weeksObserved })}
                      </MutedText>
                      <Text style={{ color: colors.text }}>{money(f.weeklyAmount)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            )}

            {forecast.classification.variable.length > 0 && (
              <>
                <Text style={styles.laneSectionTitle}>{t('cashFlowScreen.variableRatesTitle')}</Text>
                <Card>
                  {forecast.classification.variable.map((v, i) => (
                    <View key={v.category} style={[styles.forecastRow, i > 0 ? styles.rowBorder : undefined]}>
                      <MutedText>{v.category}</MutedText>
                      <Text style={{ color: colors.text }}>{money(v.ratePerMile, { maximumFractionDigits: 2 })}/mi</Text>
                    </View>
                  ))}
                </Card>
              </>
            )}

            {forecast.classification.oneOffs.length > 0 && (
              <MutedText style={{ marginTop: spacing.xs }}>
                {t('cashFlowScreen.oneOffsNote', { amount: money(oneOffTotal), count: forecast.classification.oneOffs.length })}
              </MutedText>
            )}

            {forecast.weeks.some((w) => w.periodicItems.length > 0) && (
              <>
                <Text style={styles.laneSectionTitle}>{t('cashFlowScreen.periodicTitle')}</Text>
                <Card>
                  {forecast.weeks
                    .flatMap((w) => w.periodicItems)
                    .map((p, i) => (
                      <View key={p.id} style={i > 0 ? styles.rowBorder : undefined}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text }}>{p.label}</Text>
                            <MutedText>{t('cashFlowScreen.periodicDue', { date: date(p.dueDate) })}</MutedText>
                          </View>
                          {p.amount != null ? (
                            <Text style={{ color: colors.text, fontWeight: '600' }}>{money(overrides.periodicAmounts[p.id] ?? p.amount)}</Text>
                          ) : overrides.periodicAmounts[p.id] != null ? (
                            <Text style={{ color: colors.text, fontWeight: '600' }}>{money(overrides.periodicAmounts[p.id])}</Text>
                          ) : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                              <View style={{ width: 80 }}>
                                <Field
                                  keyboardType="numeric"
                                  value={periodicDrafts[p.id] ?? ''}
                                  onChangeText={(v) => setPeriodicDrafts((d) => ({ ...d, [p.id]: v }))}
                                  placeholder={t('cashFlowScreen.periodicAmountUnknown')}
                                />
                              </View>
                              <PrimaryButton title={t('common.save')} onPress={() => savePeriodicAmount(p.id)} loading={savingPeriodicId === p.id} />
                            </View>
                          )}
                        </View>
                      </View>
                    ))}
                </Card>
              </>
            )}

            {tightestWeek && (
              <MutedText style={{ marginTop: spacing.sm }}>
                🎯{' '}
                {tightestReasonItem
                  ? t('cashFlowScreen.tightestPointWithReason', { amount: money(tightestWeek.closingBalance), date: tightestWeekLabel, label: tightestReasonItem.label })
                  : t('cashFlowScreen.tightestPointLine', { amount: money(tightestWeek.closingBalance), date: tightestWeekLabel })}
              </MutedText>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
              <Pill label={t('cashFlowScreen.period30Days')} selected={period === '30days'} onPress={() => setPeriod('30days')} />
              <Pill label={t('cashFlowScreen.periodThisMonth')} selected={period === 'thisMonth'} onPress={() => setPeriod('thisMonth')} />
              <Pill label={t('cashFlowScreen.periodMonthly')} selected={period === 'monthly'} onPress={() => setPeriod('monthly')} />
            </View>

            {period === '30days' && (
              <>
                <Text style={styles.sectionTitle}>{t('cashFlowScreen.weekByWeekTitle')}</Text>
                {forecast.weeks.map((w) => (
                  <WeekCard key={w.weekIndex} week={w} isTightest={w.weekIndex === forecast.tightestWeekIndex} />
                ))}
              </>
            )}

            {period === 'thisMonth' &&
              (thisMonthEntry ? (
                <>
                  <Text style={styles.sectionTitle}>{t('cashFlowScreen.periodThisMonth')}</Text>
                  <MonthCard m={thisMonthEntry} expanded onToggle={() => {}} isTightest={false} isBest={false} />
                </>
              ) : null)}

            {period === 'monthly' && (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
                  {availableYears.map((y) => (
                    <Pill key={y} label={String(y)} selected={monthlyYear === y} onPress={() => setMonthlyYear(y)} />
                  ))}
                </View>

                {monthlyOverview.length > 1 && (
                  <>
                    <Text style={styles.sectionTitle}>{t('cashFlowScreen.monthlyTrendTitle')}</Text>
                    <Card>
                      <MonthlyTrendChart months={monthlyOverview} />
                    </Card>
                  </>
                )}

                {tightestMonthIdx >= 0 && bestMonthIdx >= 0 && (
                  <View style={{ marginTop: spacing.sm, gap: 2 }}>
                    {/* MONTH FILTER OFF-BY-ONE fix (owner decision) — see
                        src/i18n/format.ts's formatMonthLabel() for the
                        full root-cause writeup. */}
                    <MutedText>
                      🎯{' '}
                      {t('cashFlowScreen.tightestMonthLine', {
                        month: monthLabel(monthlyOverview[tightestMonthIdx].year, monthlyOverview[tightestMonthIdx].month, {
                          year: 'numeric',
                          month: 'long',
                        }),
                        amount: money(monthlyOverview[tightestMonthIdx].closingBalance),
                      })}
                    </MutedText>
                    <MutedText>
                      🏆{' '}
                      {t('cashFlowScreen.bestMonthLine', {
                        month: monthLabel(monthlyOverview[bestMonthIdx].year, monthlyOverview[bestMonthIdx].month, {
                          year: 'numeric',
                          month: 'long',
                        }),
                        amount: money(monthlyOverview[bestMonthIdx].closingBalance),
                      })}
                    </MutedText>
                  </View>
                )}

                <Text style={styles.sectionTitle}>{t('cashFlowScreen.monthByMonthTitle')}</Text>
                {monthlyOverview.map((m, i) => {
                  const key = `${m.year}-${m.month}`;
                  return (
                    <MonthCard
                      key={key}
                      m={m}
                      expanded={expandedMonthKey === key}
                      onToggle={() => setExpandedMonthKey((cur) => (cur === key ? null : key))}
                      isTightest={i === tightestMonthIdx}
                      isBest={i === bestMonthIdx}
                    />
                  );
                })}
              </>
            )}
          </>
        )}

        {loading ? null : trend.length === 0 ? null : (
          <>
            <Text style={styles.sectionTitle}>{t('cashFlowScreen.weeklyTrendTitle')}</Text>
            <Card>
              <WeeklyTrendChart points={trend} />
            </Card>

            <Text style={styles.sectionTitle}>{t('cashFlowScreen.lanesTitle')}</Text>
            {lanes.avgRpm != null ? (
              <MutedText>{t('cashFlowScreen.avgRpm', { rate: money(lanes.avgRpm, { maximumFractionDigits: 2 }) })}</MutedText>
            ) : (
              <MutedText>{t('cashFlowScreen.noLoadData')}</MutedText>
            )}

            {lanes.best.length > 0 && (
              <>
                <Text style={styles.laneSectionTitle}>🏆 {t('cashFlowScreen.bestLanes')}</Text>
                <Card>
                  {lanes.best.map((l, i) => (
                    <View key={l.id} style={i > 0 ? styles.rowBorder : undefined}>
                      <LaneRow l={l} good />
                    </View>
                  ))}
                </Card>

                <Text style={[styles.laneSectionTitle, { color: colors.red }]}>⚠️ {t('cashFlowScreen.worstLanes')}</Text>
                <Card>
                  {lanes.worst.map((l, i) => (
                    <View key={l.id} style={i > 0 ? styles.rowBorder : undefined}>
                      <LaneRow l={l} good={false} />
                    </View>
                  ))}
                </Card>
              </>
            )}

            {lanes.excluded.length > 0 && (
              <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>
                ⚠️ {t('cashFlowScreen.excludedLanesNotice', { count: lanes.excluded.length })}
              </MutedText>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  statValue: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  overridableRow: {
    paddingVertical: spacing.xs,
  },
  forecastRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 4,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  laneSectionTitle: {
    color: colors.green,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  laneRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  laneDesc: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '600' as const,
  },
};
