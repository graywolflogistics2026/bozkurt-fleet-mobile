import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useUpdateTaxConfig } from '@/src/data/taxConfig';
import { useHouseholdMembers, useInsertHouseholdMember, useDeleteHouseholdMember } from '@/src/data/householdMembers';
import { useHouseholdIncome, useInsertHouseholdIncome, useDeleteHouseholdIncome } from '@/src/data/householdIncome';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { allQuarterlyDeadlines, type QuarterlyDeadlineStatus } from '@/src/tax/quarterly';
import { calcScorpSavingsPreview } from '@/src/tax/scorpSavings';
import type { EntityType, FilingStatus } from '@/src/tax/types';
import { useFormatters } from '@/src/i18n/format';
import {
  Screen,
  ScreenTitle,
  Card,
  MutedText,
  LegalFootnote,
  ModalSheet,
  SheetTitle,
  Field,
  PrimaryButton,
  SecondaryButton,
} from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { HouseholdIncome, HouseholdMember } from '@/src/types/db';

const FILING_STATUSES: FilingStatus[] = ['single', 'mfj', 'hoh'];
const ENTITY_TYPES: EntityType[] = ['sole_prop', 'smllc', 'multi_member_llc', 'scorp'];
const RELATIONS: HouseholdMember['relation'][] = ['spouse', 'child', 'other'];
const INCOME_TYPES: HouseholdIncome['income_type'][] = ['w2_wages', 'self_employment', 'other'];

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

function urgencyColor(urgency: QuarterlyDeadlineStatus['urgency']) {
  if (urgency === 'urgent') return colors.red;
  if (urgency === 'warn') return colors.orange;
  return colors.muted;
}

function Row({ label, value, valueColor, bold }: { label: string; value: string; valueColor?: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={bold ? styles.rowLabelBold : styles.rowLabel}>{label}</Text>
      <Text style={{ color: valueColor ?? colors.text, fontSize: typography.size.sm, fontWeight: bold ? '700' : '600' }}>
        {value}
      </Text>
    </View>
  );
}

type ConfigDraft = {
  filingStatus: FilingStatus;
  state: string;
  includeStateTax: boolean;
  entityType: EntityType;
  ownershipPct: string;
  scorpSalary: string;
  scorpPayrollTaxHandled: boolean;
  sepContribution: string;
  healthInsurancePremiums: string;
};

export default function TaxEstimator() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const taxQuery = useTaxEstimate();
  const updateTaxConfig = useUpdateTaxConfig();
  const membersQuery = useHouseholdMembers();
  const insertMember = useInsertHouseholdMember();
  const deleteMember = useDeleteHouseholdMember();
  const incomeQuery = useHouseholdIncome();
  const insertIncome = useInsertHouseholdIncome();
  const deleteIncome = useDeleteHouseholdIncome();
  const queryClient = useQueryClient();

  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [reasonableSalary, setReasonableSalary] = useState('');

  const [addingIncome, setAddingIncome] = useState(false);
  const [incomeName, setIncomeName] = useState('');
  const [incomeRelation, setIncomeRelation] = useState<HouseholdMember['relation']>('spouse');
  const [incomeType, setIncomeType] = useState<HouseholdIncome['income_type']>('w2_wages');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeWithheld, setIncomeWithheld] = useState('');
  const [incomeSaving, setIncomeSaving] = useState(false);

  const tax = taxQuery.data;

  useEffect(() => {
    if (tax && !draft) {
      setDraft({
        filingStatus: tax.taxConfig.filing_status,
        state: tax.taxConfig.state,
        includeStateTax: tax.taxConfig.include_state_tax,
        entityType: tax.taxConfig.entity_type,
        ownershipPct: tax.taxConfig.ownership_pct != null ? String(tax.taxConfig.ownership_pct) : '',
        scorpSalary: tax.taxConfig.scorp_salary != null ? String(tax.taxConfig.scorp_salary) : '',
        scorpPayrollTaxHandled: tax.taxConfig.scorp_payroll_tax_handled,
        sepContribution: String(tax.taxConfig.sep_contribution ?? 0),
        healthInsurancePremiums: String(tax.taxConfig.health_insurance_premiums ?? 0),
      });
      setReasonableSalary(tax.taxConfig.scorp_salary != null ? String(tax.taxConfig.scorp_salary) : String(Math.round(tax.estimate.netProfit * 0.4)));
    }
  }, [tax, draft]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tax_config'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['household_members'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['household_income'], refetchType: 'all' }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const incomeRows = useMemo(() => {
    const resolvedYear = tax?.resolvedYear;
    const members = new Map((membersQuery.data ?? []).map((m) => [m.id, m]));
    return (incomeQuery.data ?? [])
      .filter((row) => resolvedYear == null || row.tax_year === resolvedYear)
      .map((row) => ({ row, member: members.get(row.member_id) ?? null }))
      .sort((a, b) => (b.row.annual_amount ?? 0) - (a.row.annual_amount ?? 0));
  }, [incomeQuery.data, membersQuery.data, tax?.resolvedYear]);

  const isScorp = draft?.entityType === 'scorp';
  const scorpPreview = useMemo(() => {
    if (!tax || isScorp) return null;
    const salary = Number(reasonableSalary) || 0;
    return calcScorpSavingsPreview(tax.estimate.netProfit, salary, tax.taxYearData.se_tax);
  }, [tax, isScorp, reasonableSalary]);

  const quarters = tax ? allQuarterlyDeadlines(tax.taxYearData.quarterly_deadlines) : [];

  function openAddIncome() {
    setIncomeName('');
    setIncomeRelation('spouse');
    setIncomeType('w2_wages');
    setIncomeAmount('');
    setIncomeWithheld('');
    setAddingIncome(true);
  }

  async function handleSaveIncome() {
    const userId = tax?.taxConfig.user_id;
    if (!userId || !tax) return;
    const amount = Number(incomeAmount) || 0;
    setIncomeSaving(true);
    try {
      const member = await insertMember.mutateAsync({ user_id: userId, name: incomeName || t('taxEstimator.household.unnamed'), relation: incomeRelation });
      await insertIncome.mutateAsync({
        user_id: userId,
        member_id: member.id,
        tax_year: tax.resolvedYear,
        income_type: incomeType,
        annual_amount: amount,
        federal_withheld: Number(incomeWithheld) || 0,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household_members'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['household_income'], refetchType: 'all' }),
      ]);
      setAddingIncome(false);
    } catch (err) {
      Alert.alert(t('taxEstimator.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setIncomeSaving(false);
    }
  }

  function handleDeleteIncome(entry: { row: HouseholdIncome; member: HouseholdMember | null }) {
    Alert.alert(t('taxEstimator.household.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteIncome.mutateAsync(entry.row.id);
            // Each income entry owns a dedicated household_members row
            // (created alongside it, never shared) — safe to remove both.
            if (entry.member) await deleteMember.mutateAsync(entry.member.id);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['household_members'], refetchType: 'all' }),
              queryClient.invalidateQueries({ queryKey: ['household_income'], refetchType: 'all' }),
            ]);
          } catch (err) {
            Alert.alert(t('taxEstimator.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  async function handleSaveConfig() {
    if (!draft) return;
    setSaving(true);
    try {
      await updateTaxConfig.mutateAsync({
        filing_status: draft.filingStatus,
        state: draft.state.trim().toUpperCase() || 'TX',
        include_state_tax: draft.includeStateTax,
        entity_type: draft.entityType,
        ownership_pct: draft.entityType === 'multi_member_llc' ? Number(draft.ownershipPct) || 100 : null,
        scorp_salary: draft.entityType === 'scorp' ? Number(draft.scorpSalary) || 0 : null,
        scorp_payroll_tax_handled: draft.entityType === 'scorp' ? draft.scorpPayrollTaxHandled : false,
        sep_contribution: Number(draft.sepContribution) || 0,
        health_insurance_premiums: Number(draft.healthInsurancePremiums) || 0,
      });
      await invalidateFinancialData(queryClient);
      Alert.alert(t('taxEstimator.savedTitle'));
    } catch (err) {
      Alert.alert(t('taxEstimator.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  const loading = taxQuery.isLoading || !draft || !tax;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('taxEstimator.title')}</ScreenTitle>
        <LegalFootnote />

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            {tax.isFallback && (
              <Card>
                <MutedText>
                  {t('dashboard.yearFallbackBanner', { requestedYear: tax.requestedYear, resolvedYear: tax.resolvedYear })}
                </MutedText>
              </Card>
            )}

            {/* --- Filing status / home state --- */}
            <Text style={styles.sectionTitle}>{t('taxEstimator.filingSectionTitle')}</Text>
            <Card>
              <MutedText>{t('taxEstimator.filingStatusLabel')}</MutedText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {FILING_STATUSES.map((fs) => (
                  <Pill
                    key={fs}
                    label={t(`taxEstimator.filingStatus.${fs}`)}
                    selected={draft.filingStatus === fs}
                    onPress={() => setDraft({ ...draft, filingStatus: fs })}
                  />
                ))}
              </View>

              <View style={{ marginTop: spacing.sm }}>
                <MutedText>{t('taxEstimator.homeStateLabel')}</MutedText>
              </View>
              <Field
                value={draft.state}
                onChangeText={(v) => setDraft({ ...draft, state: v.toUpperCase().slice(0, 2) })}
                placeholder="TX"
                autoCapitalize="characters"
                maxLength={2}
              />

              <Pressable
                onPress={() => setDraft({ ...draft, includeStateTax: !draft.includeStateTax })}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}
              >
                <Text style={{ color: colors.accent, fontSize: typography.size.md, marginEnd: spacing.xs }}>
                  {draft.includeStateTax ? '☑' : '☐'}
                </Text>
                <Text style={{ color: colors.text, fontSize: typography.size.sm, flex: 1 }}>
                  {t('taxEstimator.includeStateTaxLabel')}
                </Text>
              </Pressable>
            </Card>

            {/* --- Entity selection --- */}
            <Text style={styles.sectionTitle}>{t('taxEstimator.entitySectionTitle')}</Text>
            <Card>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {ENTITY_TYPES.map((et) => (
                  <Pill
                    key={et}
                    label={t(`taxEstimator.entityType.${et}`)}
                    selected={draft.entityType === et}
                    onPress={() => setDraft({ ...draft, entityType: et })}
                  />
                ))}
              </View>

              {draft.entityType === 'multi_member_llc' && (
                <View style={{ marginTop: spacing.sm }}>
                  <MutedText>{t('taxEstimator.ownershipPctLabel')}</MutedText>
                  <Field
                    keyboardType="numeric"
                    value={draft.ownershipPct}
                    onChangeText={(v) => setDraft({ ...draft, ownershipPct: v })}
                    placeholder="100"
                  />
                  <MutedText style={{ color: colors.orange }}>{t('taxEstimator.multiMemberDisclaimer')}</MutedText>
                </View>
              )}

              {draft.entityType === 'scorp' && (
                <View style={{ marginTop: spacing.sm }}>
                  <MutedText>{t('taxEstimator.scorpSalaryLabel')}</MutedText>
                  <Field
                    keyboardType="numeric"
                    value={draft.scorpSalary}
                    onChangeText={(v) => setDraft({ ...draft, scorpSalary: v })}
                    placeholder="0.00"
                  />
                  <Pressable
                    onPress={() => setDraft({ ...draft, scorpPayrollTaxHandled: !draft.scorpPayrollTaxHandled })}
                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}
                  >
                    <Text style={{ color: colors.accent, fontSize: typography.size.md, marginEnd: spacing.xs }}>
                      {draft.scorpPayrollTaxHandled ? '☑' : '☐'}
                    </Text>
                    <Text style={{ color: colors.text, fontSize: typography.size.sm, flex: 1 }}>
                      {t('dashboard.payrollHandledByProvider')}
                    </Text>
                  </Pressable>
                  <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>{t('taxEstimator.scorpDisclaimer')}</MutedText>
                </View>
              )}
            </Card>

            {/* --- Household income --- */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={styles.sectionTitle}>{t('taxEstimator.household.title')}</Text>
              <Pressable onPress={openAddIncome} hitSlop={8}>
                <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
                  + {t('taxEstimator.household.add')}
                </Text>
              </Pressable>
            </View>
            <MutedText>{t('taxEstimator.household.subtitle')}</MutedText>
            <Card>
              {incomeRows.length === 0 ? (
                <MutedText>{t('taxEstimator.household.empty')}</MutedText>
              ) : (
                incomeRows.map((entry, i) => (
                  <View key={entry.row.id} style={[styles.row, i > 0 && styles.rowBorder, { alignItems: 'flex-start' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabelBold}>{entry.member?.name ?? '—'}</Text>
                      <MutedText>
                        {t(`taxEstimator.household.relation.${entry.member?.relation ?? 'other'}`)} ·{' '}
                        {t(`taxEstimator.household.incomeType.${entry.row.income_type}`)}
                      </MutedText>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>{money(entry.row.annual_amount)}</Text>
                      <Pressable onPress={() => handleDeleteIncome(entry)} hitSlop={8} style={{ marginTop: spacing.xs }}>
                        <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </Card>

            {/* --- SEP / health insurance --- */}
            <Text style={styles.sectionTitle}>{t('taxEstimator.otherDeductionsTitle')}</Text>
            <Card>
              <MutedText>{t('taxEstimator.sepContributionLabel')}</MutedText>
              <Field
                keyboardType="numeric"
                value={draft.sepContribution}
                onChangeText={(v) => setDraft({ ...draft, sepContribution: v })}
                placeholder="0.00"
              />
              <MutedText>{t('taxEstimator.healthInsuranceLabel')}</MutedText>
              <Field
                keyboardType="numeric"
                value={draft.healthInsurancePremiums}
                onChangeText={(v) => setDraft({ ...draft, healthInsurancePremiums: v })}
                placeholder="0.00"
              />
            </Card>

            <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveConfig} loading={saving} />

            {/* --- Full breakdown --- */}
            <Text style={styles.sectionTitle}>{t('taxEstimator.breakdownTitle')}</Text>
            <Card>
              <Row label={t('taxEstimator.netProfit')} value={money(tax.estimate.netProfit)} />
              {tax.estimate.employerPayrollTax > 0 && (
                <Row label={t('taxEstimator.employerPayrollTax')} value={`- ${money(tax.estimate.employerPayrollTax)}`} valueColor={colors.red} />
              )}
              <Row label={t('taxEstimator.ownerShareOfProfit')} value={money(tax.estimate.ownerShareOfProfit)} />
              <Row label={t('taxEstimator.seTaxBase')} value={money(tax.estimate.seTaxBase)} />
              <Row label={t('taxEstimator.seTax')} value={money(tax.estimate.seTax)} valueColor={colors.red} />
              <Row label={t('taxEstimator.seTaxDeduction')} value={money(tax.estimate.seTaxDeduction)} />
              {tax.householdIncome > 0 && <Row label={t('taxEstimator.spouseIncome')} value={money(tax.householdIncome)} />}
              <Row label={t('taxEstimator.agi')} value={money(tax.estimate.agi)} />
              <Row label={t('taxEstimator.standardDeduction')} value={`- ${money(tax.estimate.standardDeduction)}`} />
              <Row label={t('taxEstimator.taxableIncome')} value={money(tax.estimate.taxableIncome)} bold />
              <Row label={t('taxEstimator.federalTax')} value={money(tax.estimate.federalTax)} valueColor={colors.red} />
              <Row
                label={
                  tax.estimate.stateTax.label === 'estimate'
                    ? t('taxEstimator.stateTaxEstimate', { state: tax.taxConfig.state })
                    : t('taxEstimator.stateTax')
                }
                value={money(tax.estimate.stateTax.amount)}
                valueColor={colors.red}
              />
              <Row label={t('taxEstimator.totalTax')} value={money(tax.estimate.totalTax)} valueColor={colors.red} bold />
              <Row label={t('taxEstimator.effectiveRate')} value={tax.estimate.effectiveRate != null ? `${tax.estimate.effectiveRate.toFixed(1)}%` : '—'} />
            </Card>

            {/* --- Quarterly schedule --- */}
            <Text style={styles.sectionTitle}>{t('taxEstimator.quarterlyTitle')}</Text>
            <Card>
              {quarters.map((q, i) => (
                <View key={q.label} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabelBold}>{q.label}</Text>
                    <MutedText>{q.date}</MutedText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{money(tax.estimate.quarterlyPayment)}</Text>
                    <Text style={{ color: urgencyColor(q.urgency), fontSize: typography.size.xs, fontWeight: '700' }}>
                      {q.isPast
                        ? t('taxEstimator.deadlinePast')
                        : q.daysUntil === 0
                          ? t('taxEstimator.deadlineToday')
                          : t('taxEstimator.deadlineInDays', { count: q.daysUntil })}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>

            {/* --- S-Corp comparison worksheet --- */}
            {!isScorp && scorpPreview && (
              <>
                <Text style={styles.sectionTitle}>{t('dashboard.scorpPreviewTitle')}</Text>
                <MutedText>{t('dashboard.scorpPreviewNote')}</MutedText>
                <Card>
                  <MutedText>{t('taxEstimator.reasonableSalaryLabel')}</MutedText>
                  <Field keyboardType="numeric" value={reasonableSalary} onChangeText={setReasonableSalary} placeholder="0.00" />
                  <Row label={t('dashboard.currentSeTax')} value={money(scorpPreview.currentSeTax)} />
                  <Row label={t('dashboard.seTaxAtSalary')} value={money(scorpPreview.scorpSeTax)} />
                  <Row label={t('dashboard.potentialSavings')} value={money(scorpPreview.savings)} valueColor={colors.green} bold />
                </Card>
              </>
            )}

            <LegalFootnote />
          </>
        )}
      </ScrollView>

      <ModalSheet visible={addingIncome} onClose={() => setAddingIncome(false)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('taxEstimator.household.addTitle')}</SheetTitle>

          <MutedText>{t('taxEstimator.household.nameLabel')}</MutedText>
          <Field value={incomeName} onChangeText={setIncomeName} placeholder={t('taxEstimator.household.namePlaceholder')} />

          <MutedText>{t('taxEstimator.household.relationLabel')}</MutedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {RELATIONS.map((r) => (
              <Pill key={r} label={t(`taxEstimator.household.relation.${r}`)} selected={incomeRelation === r} onPress={() => setIncomeRelation(r)} />
            ))}
          </View>

          <MutedText>{t('taxEstimator.household.incomeTypeLabel')}</MutedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {INCOME_TYPES.map((it) => (
              <Pill key={it} label={t(`taxEstimator.household.incomeType.${it}`)} selected={incomeType === it} onPress={() => setIncomeType(it)} />
            ))}
          </View>

          <MutedText>{t('taxEstimator.household.annualAmountLabel')}</MutedText>
          <Field keyboardType="numeric" value={incomeAmount} onChangeText={setIncomeAmount} placeholder="0.00" />

          <MutedText>{t('taxEstimator.household.federalWithheldLabel')}</MutedText>
          <Field keyboardType="numeric" value={incomeWithheld} onChangeText={setIncomeWithheld} placeholder="0.00" />

          <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveIncome} loading={incomeSaving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setAddingIncome(false)} />
        </ScrollView>
      </ModalSheet>
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
    color: colors.muted,
    fontSize: typography.size.sm,
  },
  rowLabelBold: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
  },
};
