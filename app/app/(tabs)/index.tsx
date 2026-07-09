import { useMemo, useState, useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useFleetStats, fetchFleetStats } from '@/src/data/dashboardStats';
import { useCapitalAccountSummary } from '@/src/data/capitalAccount';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useLoads } from '@/src/data/loads';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { nextQuarterlyDeadline, type QuarterlyDeadlineStatus } from '@/src/tax/quarterly';
import { calcScorpSavingsPreview } from '@/src/tax/scorpSavings';
import { ppmColor } from '@/src/stats/cpm';
import { Screen, ScreenTitle, Card, TappableCard, MutedText, LegalFootnote, SecondaryButton, Field } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

function money(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

const FILING_STATUS_LABEL: Record<string, string> = { single: 'Single', mfj: 'MFJ', hoh: 'HOH' };

// "@$64/day (80% of $80)" — the 80% and $80 are both derived from
// tax_year_data.per_diem (docs/PENDING_SQL.md §10), never hardcoded
// (CLAUDE.md invariant #6). Degrades to just "@$64/day" until that
// migration has run and full_daily_rate exists on the live row.
function perDiemCaption(perDiem: { daily_rate: number; full_daily_rate?: number } | undefined): string | null {
  if (!perDiem) return null;
  if (!perDiem.full_daily_rate) return `@$${perDiem.daily_rate}/day`;
  const pct = Math.round((perDiem.daily_rate / perDiem.full_daily_rate) * 100);
  return `@$${perDiem.daily_rate}/day (${pct}% of $${perDiem.full_daily_rate})`;
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

  // Fleet scalability (owner decision 2026-07-03): the per-truck ranking
  // below re-uses the SAME fetchFleetStats() function the single-truck
  // cards above call — parameterized by truck_id, no separate fleet code
  // path. Only fetched at all once there's a second truck to rank.
  const fleetQueries = useQueries({
    queries:
      trucks.length > 1
        ? trucks.map((t) => ({
            queryKey: ['fleet-stats', userId, t.id],
            queryFn: () => fetchFleetStats(userId as string, t.id),
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
      .map((t, i) => {
        const data = fleetQueries[i]?.data;
        const ppm = data?.cpm.profitPerMile ?? null;
        return { truck: t, stats: data, ppm };
      })
      .filter((r) => r.stats)
      .sort((a, b) => (b.ppm ?? -Infinity) - (a.ppm ?? -Infinity));
  }, [trucks, fleetQueries]);

  const drawsLabel = isScorp ? 'Distributions' : 'Draws';

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <ScreenTitle>Dashboard</ScreenTitle>

        <Card>
          <Text style={{ color: colors.text, fontSize: typography.size.md }}>{session?.user.email}</Text>
          {profile?.company_name ? <MutedText>{profile.company_name}</MutedText> : null}
        </Card>

        {tax?.isFallback && !bannerDismissed && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <MutedText>
                {tax.requestedYear} IRS figures not loaded yet — estimates use {tax.resolvedYear} data.
              </MutedText>
              <Pressable onPress={() => setBannerDismissed(true)} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: typography.size.md, marginLeft: spacing.sm }}>✕</Text>
              </Pressable>
            </View>
          </Card>
        )}

        {trucksLoading ? (
          <Card>
            <MutedText>Loading…</MutedText>
          </Card>
        ) : trucks.length === 0 ? (
          <Card>
            <MutedText>No trucks yet. Import a legacy backup or add one in Settings to get started.</MutedText>
          </Card>
        ) : (
          <>
            {/* Row 1 — CLAUDE.md Dashboard card parity: card-for-card, same
                order, same empty-state hints as the legacy web dashboard. */}
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue label="Total Revenue" value={stats ? money(stats.grossRevenue) : '—'} valueColor={colors.green} />
              <MutedText>Import PDF to start</MutedText>
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/deductions')}>
              <StatValue label="Total Deductions" value={stats ? money(stats.totalDeductions) : '—'} valueColor={colors.red} />
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue
                label="Net to Owner"
                value={stats ? money(stats.netRevenue) : '—'}
                valueColor={stats && stats.netRevenue < 0 ? colors.red : colors.green}
              />
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue label="Miles Driven" value={stats ? stats.totalMiles.toLocaleString() : '—'} />
            </TappableCard>

            {/* Row 2 */}
            <TappableCard onPress={() => router.push('/(tabs)/more/tax-estimator')}>
              <StatValue label="YTD Per Diem Days" value={stats ? `${stats.perDiemDays}` : '—'} valueColor={colors.accent} />
              <MutedText>days on road</MutedText>
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/tax-estimator')}>
              <StatValue label="Per Diem Deduction" value={tax ? money(tax.perDiemDeduction) : '—'} valueColor={colors.green} />
              {perDiemCaption(tax?.taxYearData.per_diem) && <MutedText>{perDiemCaption(tax?.taxYearData.per_diem)}</MutedText>}
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue label="Weeks in Service" value={stats ? `${stats.settlementCount}` : '—'} />
              <MutedText>settlements imported</MutedText>
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue label="Avg Net/Week" value={stats ? money(stats.avgNetPerWeek) : '—'} />
              <MutedText>direct deposit avg</MutedText>
            </TappableCard>

            {/* Row 3 */}
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue
                label="Business Balance"
                value={money(capital?.businessBalance ?? 0)}
                valueColor={
                  (capital?.businessBalance ?? 0) > 10000
                    ? colors.green
                    : (capital?.businessBalance ?? 0) > 3000
                      ? colors.orange
                      : colors.red
                }
              />
              <MutedText>checking account</MutedText>
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue
                label="Revenue/Mile"
                value={stats?.cpm.revenuePerMile != null ? `$${stats.cpm.revenuePerMile.toFixed(2)}` : '—'}
                valueColor={colors.green}
              />
              <MutedText>gross ÷ total miles</MutedText>
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue
                label="Cost/Mile (CPM)"
                value={stats?.cpm.costPerMile != null ? `$${stats.cpm.costPerMile.toFixed(2)}` : '—'}
                valueColor={colors.red}
              />
              <MutedText>all costs ÷ total miles</MutedText>
            </TappableCard>
            <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
              <StatValue
                label="Profit/Mile"
                value={stats?.cpm.profitPerMile != null ? `$${stats.cpm.profitPerMile.toFixed(2)}` : '—'}
                valueColor={stats?.cpm.profitPerMile != null ? colors[ppmColor(stats.cpm.profitPerMile)] : undefined}
              />
              <MutedText>accept loads above CPM!</MutedText>
            </TappableCard>
          </>
        )}

        {/* Tax row — CLAUDE.md invariant #8: estimates only, never presented
            as definitive. */}
        <ScreenTitle>Tax</ScreenTitle>
        <TappableCard onPress={() => router.push('/(tabs)/more/tax-estimator')}>
          <StatValue label="Est. Total Tax" value={tax ? money(tax.estimate.totalTax) : '—'} valueColor={colors.red} />
          {tax && <MutedText>{FILING_STATUS_LABEL[tax.taxConfig.filing_status] ?? tax.taxConfig.filing_status} — SE + Federal</MutedText>}
        </TappableCard>
        <TappableCard onPress={() => router.push('/(tabs)/more/tax-estimator')}>
          <StatValue label="Quarterly Payment" value={tax ? money(tax.estimate.quarterlyPayment) : '—'} valueColor={colors.red} />
          {deadline ? (
            <Text style={{ color: urgencyColor(deadline.urgency), fontSize: typography.size.sm, marginTop: 2 }}>
              {deadline.label} due in {deadline.daysUntil} day{deadline.daysUntil === 1 ? '' : 's'} ({deadline.date})
            </Text>
          ) : (
            <MutedText>next due date</MutedText>
          )}
        </TappableCard>
        <TappableCard onPress={() => router.push('/(tabs)/more/tax-estimator')}>
          <StatValue label="Weekly Tax Reserve" value={tax ? money(tax.estimate.weeklyTaxReserve) : '—'} />
          <Text style={{ color: colors.orange, fontSize: typography.size.sm, marginTop: 2 }}>set aside weekly</Text>
        </TappableCard>
        <TappableCard onPress={() => router.push('/(tabs)/more/tax-estimator')}>
          <StatValue
            label="Effective Rate"
            value={tax?.estimate.effectiveRate != null ? `${tax.estimate.effectiveRate.toFixed(1)}%` : '—'}
          />
          <MutedText>of net profit</MutedText>
          {tax?.estimate.stateTax.label === 'estimate' && (
            <MutedText>State tax is a rough estimate for {tax.taxConfig.state} — not bracket-accurate.</MutedText>
          )}
        </TappableCard>
        <LegalFootnote />

        {isScorp && (
          <Card>
            <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>
              S-Corp status requires a payroll provider
            </Text>
            <MutedText>
              W-2 salary and 941/940 filings need a payroll provider and CPA guidance — this app estimates, it does
              not file.
            </MutedText>
            <Text style={{ color: colors.text, marginTop: spacing.sm }}>
              {tax?.taxConfig.scorp_payroll_tax_handled ? '☑' : '☐'} Payroll taxes handled by a provider
            </Text>
          </Card>
        )}

        {!isScorp && scorpPreview && (
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>S-Corp Savings Preview</Text>
            <MutedText>
              Educational only — not a filing recommendation. Reasonable salary ($):
            </MutedText>
            <Field
              keyboardType="numeric"
              placeholder={String(scorpPreview.defaultSalary)}
              value={reasonableSalaryInput}
              onChangeText={setReasonableSalaryInput}
              style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <MutedText>Current SE tax</MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(scorpPreview.currentSeTax)}</Text>
              </View>
              <View>
                <MutedText>SE tax at salary</MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(scorpPreview.scorpSeTax)}</Text>
              </View>
              <View>
                <MutedText>Potential savings</MutedText>
                <Text style={{ color: colors.green, fontWeight: '700' }}>{money(scorpPreview.savings)}</Text>
              </View>
            </View>
            <LegalFootnote />
          </Card>
        )}

        {/* Capital Account strip */}
        <ScreenTitle>Capital Account</ScreenTitle>
        <TappableCard onPress={() => router.push('/(tabs)/more/capital-account')}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <MutedText>Contributed</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {capital ? money(capital.effectiveContribution) : '—'}
              </Text>
            </View>
            <View>
              <MutedText>{drawsLabel}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{capital ? money(capital.totalDraws) : '—'}</Text>
            </View>
            <View>
              <MutedText>Tax-Free Left</MutedText>
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
              · {capital.contributionCount} extra contribution{capital.contributionCount > 1 ? 's' : ''}, latest:{' '}
              {(capital.latestContributionNote ?? '').split(' — ')[0].slice(0, 45)} (
              {capital.latestContributionDate})
            </MutedText>
          )}
        </TappableCard>

        {/* Recent loads */}
        <ScreenTitle>Recent Loads</ScreenTitle>
        <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
          {recentLoads.length === 0 ? (
            <MutedText>No loads yet.</MutedText>
          ) : (
            <View>
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

        {/* Truck card */}
        {activeTruck && (
          <TappableCard onPress={() => router.push('/(tabs)/truck-health')}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {activeTruck.year ?? ''} {activeTruck.make ?? ''} {activeTruck.model ?? ''}
            </Text>
            <MutedText>Unit: {activeTruck.unit_number ?? '—'}</MutedText>
          </TappableCard>
        )}

        {/* Fleet Overview — only renders with 2+ trucks (owner decision
            2026-07-03: 1→100 trucks, no separate code path). */}
        {trucks.length > 1 && (
          <>
            <ScreenTitle>Fleet Overview</ScreenTitle>
            <Card>
              {fleetRanking.map((r, i) => (
                <View
                  key={r.truck.id}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}
                >
                  <MutedText>
                    {i === fleetRanking.length - 1 ? '⚠ ' : ''}
                    Unit {r.truck.unit_number ?? r.truck.id}
                  </MutedText>
                  <Text style={{ color: r.ppm != null ? colors[ppmColor(r.ppm)] : colors.text, fontWeight: '700' }}>
                    {r.ppm != null ? `$${r.ppm.toFixed(2)}/mi` : '—'}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <SecondaryButton title="Sign Out" onPress={signOut} />
      </ScrollView>
    </Screen>
  );
}
