import { useMemo, useState, useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useFleetStats, fetchFleetStats, fetchDriverStats } from '@/src/data/dashboardStats';
import { useDrivers } from '@/src/data/drivers';
import { useCapitalAccountSummary } from '@/src/data/capitalAccount';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useLoads } from '@/src/data/loads';
import { useDashboardLayout } from '@/src/data/dashboardLayout';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { nextQuarterlyDeadline, type QuarterlyDeadlineStatus } from '@/src/tax/quarterly';
import { calcScorpSavingsPreview } from '@/src/tax/scorpSavings';
import { ppmColor } from '@/src/stats/cpm';
import { CARD_LABEL_KEYS, type DashboardCardId } from '@/src/stats/dashboardLayout';
import { Screen, ScreenTitle, Card, TappableCard, MutedText, LegalFootnote, SecondaryButton, Field } from '@/src/components/ui';
import { useFormatters } from '@/src/i18n/format';
import { colors, spacing, typography } from '@/src/theme';

const FILING_STATUS_LABEL: Record<string, string> = { single: 'Single', mfj: 'MFJ', hoh: 'HOH' };

// "@$64/day (80% of $80)" — the 80% and $80 are both derived from
// tax_year_data.per_diem (docs/PENDING_SQL.md §10), never hardcoded
// (CLAUDE.md invariant #6). Degrades to just "@$64/day" until that
// migration has run and full_daily_rate exists on the live row.
function perDiemCaption(
  perDiem: { daily_rate: number; full_daily_rate?: number } | undefined,
  t: TFunction
): string | null {
  if (!perDiem) return null;
  if (!perDiem.full_daily_rate) return t('dashboard.perDiemCaptionSimple', { rate: perDiem.daily_rate });
  const pct = Math.round((perDiem.daily_rate / perDiem.full_daily_rate) * 100);
  return t('dashboard.perDiemCaptionFull', { rate: perDiem.daily_rate, pct, fullRate: perDiem.full_daily_rate });
}

function urgencyColor(urgency: QuarterlyDeadlineStatus['urgency']) {
  if (urgency === 'urgent') return colors.red;
  if (urgency === 'warn') return colors.orange;
  return colors.muted;
}

function StatValue({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View>
      <MutedText>{label}</MutedText>
      <Text style={{ color: valueColor ?? colors.text, fontSize: typography.size.xl, fontWeight: '700', marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { money: moneyFmt, number } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const { session, profile, signOut } = useAuth();
  const { trucks, activeTruck, loading: trucksLoading } = useActiveTruck();
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [reasonableSalaryInput, setReasonableSalaryInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const statsQuery = useFleetStats(activeTruck?.id ?? null);
  const capitalQuery = useCapitalAccountSummary();
  const taxQuery = useTaxEstimate();
  const loadsQuery = useLoads();
  const layoutQuery = useDashboardLayout();
  const driversQuery = useDrivers({ active: true });
  const drivers = driversQuery.data ?? [];

  // Fleet scalability (owner decision 2026-07-03): the per-truck ranking
  // below re-uses the SAME fetchFleetStats() function the single-truck
  // cards above call — parameterized by truck_id, no separate fleet code
  // path. Only fetched at all once there's a second truck to rank.
  const fleetQueries = useQueries({
    queries:
      trucks.length > 1
        ? trucks.map((truck) => ({
            queryKey: ['fleet-stats', userId, truck.id],
            queryFn: () => fetchFleetStats(userId as string, truck.id),
            enabled: !!userId,
          }))
        : [],
  });

  // Per-driver dashboard breakdown (PROMPTS.md Session 9a item 7): same
  // useQueries-per-entity pattern as Fleet Overview above, gated on 2+
  // active drivers (an account with 0-1 drivers never sees it — the same
  // n≤1 shortcut fleet-scalability uses everywhere else, CLAUDE.md
  // invariant #7).
  const driverQueries = useQueries({
    queries:
      drivers.length > 1
        ? drivers.map((driver) => ({
            queryKey: ['driver-stats', userId, driver.id],
            queryFn: () => fetchDriverStats(userId as string, driver.id),
            enabled: !!userId,
          }))
        : [],
  });

  const stats = statsQuery.data;
  const capital = capitalQuery.data;
  const tax = taxQuery.data;
  const deadline = tax ? nextQuarterlyDeadline(tax.taxYearData.quarterly_deadlines) : null;

  const recentLoads = useMemo(() => {
    return [...(loadsQuery.data ?? [])]
      .sort((a, b) => new Date(b.load_date ?? 0).getTime() - new Date(a.load_date ?? 0).getTime())
      .slice(0, 4);
  }, [loadsQuery.data]);

  const isScorp = tax?.taxConfig.entity_type === 'scorp';
  const scorpPreview = useMemo(() => {
    if (!tax || isScorp) return null;
    const netProfit = tax.estimate.netProfit;
    const defaultSalary = Math.round((netProfit * 0.4) / 1000) * 1000;
    const salary = reasonableSalaryInput === '' ? defaultSalary : Number(reasonableSalaryInput) || 0;
    return { salary, defaultSalary, ...calcScorpSavingsPreview(netProfit, salary, tax.taxYearData.se_tax) };
  }, [tax, isScorp, reasonableSalaryInput]);

  const fleetRanking = useMemo(() => {
    if (trucks.length <= 1) return [];
    return trucks
      .map((truck, i) => {
        const data = fleetQueries[i]?.data;
        const ppm = data?.cpm.profitPerMile ?? null;
        return { truck, stats: data, ppm };
      })
      .filter((r) => r.stats)
      .sort((a, b) => (b.ppm ?? -Infinity) - (a.ppm ?? -Infinity));
  }, [trucks, fleetQueries]);

  const driverRanking = useMemo(() => {
    if (drivers.length <= 1) return [];
    return drivers
      .map((driver, i) => ({ driver, stats: driverQueries[i]?.data }))
      .filter((r) => r.stats);
  }, [drivers, driverQueries]);

  const drawsLabel = isScorp ? t('dashboard.distributions') : t('dashboard.draws');

  // Customizable dashboard (CLAUDE.md invariant #17, PROMPTS.md Session 9a
  // item 8): every reorderable/hideable/renamable card's JSX lives in this
  // renderer map, keyed by the stable id from src/stats/dashboardLayout.ts.
  // The DEFAULT (never-customized) render path below calls these in their
  // fixed, grouped, section-headered order — identical output to before
  // this feature existed, zero behavior change for the common case. The
  // CUSTOMIZED path (dashboard-customize.tsx has been used at least once)
  // renders the same functions as one flat list in the user's chosen
  // order/visibility/labels — deliberately without the section headers,
  // since headers stop making sense once cards can move freely between
  // what used to be separate groups.
  const cardRenderers: Partial<Record<DashboardCardId, (label: string) => React.ReactNode>> = {
    totalRevenue: (label) => (
      <TappableCard key="totalRevenue" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? money(stats.grossRevenue) : '—'} valueColor={colors.green} />
        <MutedText>{t('dashboard.importToStart')}</MutedText>
      </TappableCard>
    ),
    totalDeductions: (label) => (
      <TappableCard key="totalDeductions" onPress={() => router.push('/(tabs)/deductions')}>
        <StatValue label={label} value={stats ? money(stats.totalDeductions) : '—'} valueColor={colors.red} />
      </TappableCard>
    ),
    netToOwner: (label) => (
      <TappableCard key="netToOwner" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats ? money(stats.netRevenue) : '—'}
          valueColor={stats && stats.netRevenue < 0 ? colors.red : colors.green}
        />
      </TappableCard>
    ),
    milesDriven: (label) => (
      <TappableCard key="milesDriven" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? number(stats.totalMiles) : '—'} />
      </TappableCard>
    ),
    ytdPerDiemDays: (label) => (
      <TappableCard key="ytdPerDiemDays" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={stats ? `${stats.perDiemDays}` : '—'} valueColor={colors.accent} />
        <MutedText>{t('dashboard.daysOnRoad')}</MutedText>
      </TappableCard>
    ),
    perDiemDeduction: (label) => (
      <TappableCard key="perDiemDeduction" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.perDiemDeduction) : '—'} valueColor={colors.green} />
        {perDiemCaption(tax?.taxYearData.per_diem, t) && <MutedText>{perDiemCaption(tax?.taxYearData.per_diem, t)}</MutedText>}
      </TappableCard>
    ),
    weeksInService: (label) => (
      <TappableCard key="weeksInService" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? `${stats.settlementCount}` : '—'} />
        <MutedText>{t('dashboard.settlementsImported')}</MutedText>
      </TappableCard>
    ),
    avgNetPerWeek: (label) => (
      <TappableCard key="avgNetPerWeek" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? money(stats.avgNetPerWeek) : '—'} />
        <MutedText>{t('dashboard.directDepositAvg')}</MutedText>
      </TappableCard>
    ),
    businessBalance: (label) => (
      <TappableCard key="businessBalance" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={money(capital?.businessBalance ?? 0)}
          valueColor={
            (capital?.businessBalance ?? 0) > 10000 ? colors.green : (capital?.businessBalance ?? 0) > 3000 ? colors.orange : colors.red
          }
        />
        <MutedText>{t('dashboard.checkingAccount')}</MutedText>
      </TappableCard>
    ),
    revenuePerMile: (label) => (
      <TappableCard key="revenuePerMile" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats?.cpm.revenuePerMile != null ? moneyFmt(stats.cpm.revenuePerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          valueColor={colors.green}
        />
        <MutedText>{t('dashboard.grossDividedByMiles')}</MutedText>
      </TappableCard>
    ),
    costPerMile: (label) => (
      <TappableCard key="costPerMile" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats?.cpm.costPerMile != null ? moneyFmt(stats.cpm.costPerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          valueColor={colors.red}
        />
        <MutedText>{t('dashboard.allCostsDividedByMiles')}</MutedText>
      </TappableCard>
    ),
    profitPerMile: (label) => (
      <TappableCard key="profitPerMile" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats?.cpm.profitPerMile != null ? moneyFmt(stats.cpm.profitPerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          valueColor={stats?.cpm.profitPerMile != null ? colors[ppmColor(stats.cpm.profitPerMile)] : undefined}
        />
        <MutedText>{t('dashboard.acceptLoadsAboveCpm')}</MutedText>
      </TappableCard>
    ),
    estTotalTax: (label) => (
      <TappableCard key="estTotalTax" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.estimate.totalTax) : '—'} valueColor={colors.red} />
        {tax && (
          <MutedText>
            {t('dashboard.filingStatusCaption', {
              filingStatus: FILING_STATUS_LABEL[tax.taxConfig.filing_status] ?? tax.taxConfig.filing_status,
            })}
          </MutedText>
        )}
      </TappableCard>
    ),
    quarterlyPayment: (label) => (
      <TappableCard key="quarterlyPayment" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.estimate.quarterlyPayment) : '—'} valueColor={colors.red} />
        {deadline ? (
          <Text style={{ color: urgencyColor(deadline.urgency), fontSize: typography.size.sm, marginTop: 2 }}>
            {t('dashboard.deadlineDueWithDate', {
              deadline: t('dashboard.deadlineDue', { label: deadline.label, count: deadline.daysUntil }),
              date: deadline.date,
            })}
          </Text>
        ) : (
          <MutedText>{t('dashboard.nextDueDate')}</MutedText>
        )}
      </TappableCard>
    ),
    weeklyTaxReserve: (label) => (
      <TappableCard key="weeklyTaxReserve" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.estimate.weeklyTaxReserve) : '—'} />
        <Text style={{ color: colors.orange, fontSize: typography.size.sm, marginTop: 2 }}>{t('dashboard.setAsideWeekly')}</Text>
      </TappableCard>
    ),
    effectiveRate: (label) => (
      <TappableCard key="effectiveRate" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax?.estimate.effectiveRate != null ? `${tax.estimate.effectiveRate.toFixed(1)}%` : '—'} />
        <MutedText>{t('dashboard.ofNetProfit')}</MutedText>
        {tax?.estimate.stateTax.label === 'estimate' && (
          <MutedText>{t('dashboard.stateTaxEstimateNote', { state: tax.taxConfig.state })}</MutedText>
        )}
      </TappableCard>
    ),
    capitalAccountStrip: (label) => (
      <TappableCard key="capitalAccountStrip" onPress={() => router.push('/(tabs)/more/capital-account')}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <MutedText>{t('dashboard.contributed')}</MutedText>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{capital ? money(capital.effectiveContribution) : '—'}</Text>
          </View>
          <View>
            <MutedText>{drawsLabel}</MutedText>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{capital ? money(capital.totalDraws) : '—'}</Text>
          </View>
          <View>
            <MutedText>{t('dashboard.taxFreeLeft')}</MutedText>
            <Text
              style={{
                fontWeight: '700',
                color: capital && capital.effectiveContribution - capital.totalDraws > 0 ? colors.green : colors.red,
              }}
            >
              {capital ? money(capital.taxFreeRemaining) : '—'}
            </Text>
          </View>
        </View>
        {capital && capital.contributionCount > 0 && (
          <MutedText>
            {t('dashboard.extraContribution', {
              count: capital.contributionCount,
              note: (capital.latestContributionNote ?? '').split(' — ')[0].slice(0, 45),
              date: capital.latestContributionDate,
            })}
          </MutedText>
        )}
        {label !== t('dashboard.capitalAccountTitle') && <MutedText>{label}</MutedText>}
      </TappableCard>
    ),
    recentLoads: (label) => (
      <TappableCard key="recentLoads" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        {recentLoads.length === 0 ? (
          <MutedText>{t('dashboard.noLoadsYet')}</MutedText>
        ) : (
          <View>
            {label !== t('dashboard.recentLoadsTitle') && <MutedText style={{ marginBottom: spacing.xs }}>{label}</MutedText>}
            {recentLoads.map((l) => (
              <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                <MutedText>
                  {l.order_number ?? '—'} · {l.origin ?? '—'} → {l.destination ?? '—'}
                </MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(l.revenue)}</Text>
              </View>
            ))}
          </View>
        )}
      </TappableCard>
    ),
    truckCard: (label) =>
      activeTruck ? (
        <TappableCard key="truckCard" onPress={() => router.push('/(tabs)/truck-health')}>
          {label !== t('dashboard.truckCardLabel') && <MutedText>{label}</MutedText>}
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {activeTruck.year ?? ''} {activeTruck.make ?? ''} {activeTruck.model ?? ''}
          </Text>
          <MutedText>{t('dashboard.truckUnit', { unit: activeTruck.unit_number ?? '—' })}</MutedText>
        </TappableCard>
      ) : null,
    fleetOverview: (label) =>
      trucks.length > 1 ? (
        <Card key="fleetOverview">
          {label !== t('dashboard.fleetOverviewTitle') && (
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{label}</Text>
          )}
          {fleetRanking.map((r, i) => (
            <View key={r.truck.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
              <MutedText>
                {i === fleetRanking.length - 1 ? '⚠ ' : ''}
                {t('common.unit', { unit: r.truck.unit_number ?? r.truck.id })}
              </MutedText>
              <Text style={{ color: r.ppm != null ? colors[ppmColor(r.ppm)] : colors.text, fontWeight: '700' }}>
                {r.ppm != null ? `${moneyFmt(r.ppm, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mi` : '—'}
              </Text>
            </View>
          ))}
        </Card>
      ) : null,
    driverOverview: (label) =>
      drivers.length > 1 ? (
        <Card key="driverOverview">
          {label !== t('dashboard.driverOverviewTitle') && (
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{label}</Text>
          )}
          {driverRanking.map((r) => (
            <View key={r.driver.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
              <MutedText>{r.driver.name}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{r.stats ? money(r.stats.netRevenue) : '—'}</Text>
            </View>
          ))}
        </Card>
      ) : null,
  };

  function renderCard(id: DashboardCardId, overrideLabel: string | null) {
    const defaultLabel = t(CARD_LABEL_KEYS[id] ?? id);
    return cardRenderers[id]?.(overrideLabel || defaultLabel) ?? null;
  }

  const isCustomized = layoutQuery.data?.isCustomized ?? false;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('dashboard.title')}</ScreenTitle>
          <Pressable onPress={() => router.push('/(tabs)/more/dashboard-customize')} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
              {t('dashboard.customize')}
            </Text>
          </Pressable>
        </View>

        <Card>
          <Text style={{ color: colors.text, fontSize: typography.size.md }}>{session?.user.email}</Text>
          {profile?.company_name ? <MutedText>{profile.company_name}</MutedText> : null}
        </Card>

        {tax?.isFallback && !bannerDismissed && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <MutedText>
                {t('dashboard.yearFallbackBanner', { requestedYear: tax.requestedYear, resolvedYear: tax.resolvedYear })}
              </MutedText>
              <Pressable onPress={() => setBannerDismissed(true)} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: typography.size.md, marginStart: spacing.sm }}>✕</Text>
              </Pressable>
            </View>
          </Card>
        )}

        {trucksLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : trucks.length === 0 ? (
          <Card>
            <MutedText>{t('dashboard.noTrucks')}</MutedText>
          </Card>
        ) : isCustomized && layoutQuery.data ? (
          // Customized layout: one flat list, user's own order/visibility/
          // labels, no section headers (PROMPTS.md Session 9a item 8 — see
          // the cardRenderers comment above for why headers are dropped
          // here specifically).
          <>
            {layoutQuery.data.layout
              .filter((row) => row.visible)
              .map((row) => (
                <View key={row.id}>{renderCard(row.id as DashboardCardId, row.label)}</View>
              ))}
          </>
        ) : (
          <>
            {/* Row 1 — CLAUDE.md Dashboard card parity: card-for-card, same
                order, same empty-state hints as the legacy web dashboard. */}
            {renderCard('totalRevenue', null)}
            {renderCard('totalDeductions', null)}
            {renderCard('netToOwner', null)}
            {renderCard('milesDriven', null)}

            {/* Row 2 */}
            {renderCard('ytdPerDiemDays', null)}
            {renderCard('perDiemDeduction', null)}
            {renderCard('weeksInService', null)}
            {renderCard('avgNetPerWeek', null)}

            {/* Row 3 */}
            {renderCard('businessBalance', null)}
            {renderCard('revenuePerMile', null)}
            {renderCard('costPerMile', null)}
            {renderCard('profitPerMile', null)}
          </>
        )}

        {(!isCustomized || !layoutQuery.data) && (
          <>
            {/* Tax row — CLAUDE.md invariant #8: estimates only, never presented
                as definitive. */}
            <ScreenTitle>{t('dashboard.taxSectionTitle')}</ScreenTitle>
            {renderCard('estTotalTax', null)}
            {renderCard('quarterlyPayment', null)}
            {renderCard('weeklyTaxReserve', null)}
            {renderCard('effectiveRate', null)}
          </>
        )}

        {/* CLAUDE.md invariant #8: every screen showing tax figures needs
            this disclaimer — rendered unconditionally here (not only inside
            the default-layout tax section above) so a customized layout
            that still shows tax cards never loses it. */}
        <LegalFootnote />

        {/* Driver compensation types (owner decision 2026-07-10): 1099
            contractors crossing the NEC filing threshold YTD. Informational
            banners, not part of the customizable card set. */}
        {tax && tax.contractLaborYtd.some((c) => c.needsNecReminder) && (
          <Card>
            <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>
              {t('dashboard.necReminderTitle')}
            </Text>
            {tax.contractLaborYtd
              .filter((c) => c.needsNecReminder)
              .map((c) => (
                <MutedText key={c.driverId}>
                  {t('dashboard.necReminderBody', {
                    name: c.driverName,
                    amount: money(c.ytdTotal),
                    deadline: tax.taxYearData.nec_1099?.filing_deadline ?? t('common.dash'),
                  })}
                </MutedText>
              ))}
          </Card>
        )}

        {isScorp && (
          <Card>
            <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>
              {t('dashboard.scorpPayrollTitle')}
            </Text>
            <MutedText>{t('dashboard.scorpPayrollNote')}</MutedText>
            <Text style={{ color: colors.text, marginTop: spacing.sm }}>
              {tax?.taxConfig.scorp_payroll_tax_handled ? '☑' : '☐'} {t('dashboard.payrollHandledByProvider')}
            </Text>
          </Card>
        )}

        {!isScorp && scorpPreview && (
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('dashboard.scorpPreviewTitle')}</Text>
            <MutedText>{t('dashboard.scorpPreviewNote')}</MutedText>
            <Field
              keyboardType="numeric"
              placeholder={String(scorpPreview.defaultSalary)}
              value={reasonableSalaryInput}
              onChangeText={setReasonableSalaryInput}
              style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <MutedText>{t('dashboard.currentSeTax')}</MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(scorpPreview.currentSeTax)}</Text>
              </View>
              <View>
                <MutedText>{t('dashboard.seTaxAtSalary')}</MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(scorpPreview.scorpSeTax)}</Text>
              </View>
              <View>
                <MutedText>{t('dashboard.potentialSavings')}</MutedText>
                <Text style={{ color: colors.green, fontWeight: '700' }}>{money(scorpPreview.savings)}</Text>
              </View>
            </View>
            <LegalFootnote />
          </Card>
        )}

        {(!isCustomized || !layoutQuery.data) && (
          <>
            {/* Capital Account strip */}
            <ScreenTitle>{t('dashboard.capitalAccountTitle')}</ScreenTitle>
            {renderCard('capitalAccountStrip', null)}

            {/* Recent loads */}
            <ScreenTitle>{t('dashboard.recentLoadsTitle')}</ScreenTitle>
            {renderCard('recentLoads', null)}

            {/* Truck card */}
            {renderCard('truckCard', null)}

            {/* Fleet Overview — only renders with 2+ trucks (owner decision
                2026-07-03: 1→100 trucks, no separate code path). */}
            {trucks.length > 1 && (
              <>
                <ScreenTitle>{t('dashboard.fleetOverviewTitle')}</ScreenTitle>
                {renderCard('fleetOverview', null)}
              </>
            )}

            {drivers.length > 1 && (
              <>
                <ScreenTitle>{t('dashboard.driverOverviewTitle')}</ScreenTitle>
                {renderCard('driverOverview', null)}
              </>
            )}
          </>
        )}

        <SecondaryButton title={t('common.signOut')} onPress={signOut} />
      </ScrollView>
    </Screen>
  );
}
