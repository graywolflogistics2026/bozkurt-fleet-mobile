import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements, useDeleteSettlement, useUpdateSettlement } from '@/src/data/settlements';
import { clampPerDiemDays } from '@/src/tax/perDiem';
import { useDeductions, useUpdateDeduction } from '@/src/data/deductions';
import { useReimbursements } from '@/src/data/reimbursements';
import { useLoads } from '@/src/data/loads';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useDocuments } from '@/src/data/documents';
import { useFleetStats } from '@/src/data/dashboardStats';
import { calcEscrowBalance } from '@/src/stats/escrowBalance';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useMarkDocumentReviewed } from '@/src/data/needsReviewMutations';
import { findRowToAutoOpen } from '@/src/navigation/autoOpenParam';
import { buildLinkedRecordHref } from '@/src/navigation/linkedRecordRoute';
import { findLinkedRecords, type LinkedRecordRef } from '@/src/data/documentsFilter';
import { MonthGroupedList } from '@/src/components/monthGroups/MonthGroupedList';
import { needsReviewRowStyle, NeedsReviewChip, MarkReviewedButton } from '@/src/components/NeedsReviewBadge';
import { DestinationSummary } from '@/src/components/DestinationSummary';
import { isSettlementNeedsReview } from '@/src/import/needsReview';
import { useFormatters } from '@/src/i18n/format';
import {
  Screen,
  ScreenTitle,
  Card,
  MutedText,
  TappableCard,
  ModalSheet,
  SheetTitle,
  SecondaryButton,
  Field,
} from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { Settlement } from '@/src/types/db';
import type { ExtractedRevenueItem } from '@/src/import/types';

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

function extractRevenueItems(parsedJson: Record<string, unknown> | null | undefined): ExtractedRevenueItem[] {
  const settlement = parsedJson?.settlement;
  if (!settlement || typeof settlement !== 'object') return [];
  const items = (settlement as Record<string, unknown>).revenueItems;
  return Array.isArray(items) ? (items as ExtractedRevenueItem[]) : [];
}

export default function Settlements() {
  const { t } = useTranslation();
  const { money, number, date } = useFormatters();
  const router = useRouter();
  const { openId } = useLocalSearchParams<{ openId?: string }>();
  const autoOpenedRef = useRef(false);
  const settlementsQuery = useSettlements();
  const deleteSettlement = useDeleteSettlement();
  const updateSettlement = useUpdateSettlement();
  const dedQuery = useDeductions();
  const updateDeduction = useUpdateDeduction();
  const reimbQuery = useReimbursements();
  const loadsQuery = useLoads();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const documentsQuery = useDocuments();
  const fleetStats = useFleetStats(null);
  const markDocumentReviewed = useMarkDocumentReviewed();
  const [markingAllReviewed, setMarkingAllReviewed] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Settlement | null>(null);
  // BETA FEEDBACK ROUND 2: "Needs review only" filter, same treatment as
  // Deductions/Documents/Transactions.
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  // PER DIEM INTELLIGENCE (owner decision 2026-07-30): per_diem_days is
  // editable right here on the detail sheet, not just at import time — a
  // user correcting an old "home week" that got the wrong smart default.
  const [perDiemDraft, setPerDiemDraft] = useState('');
  const [savingPerDiem, setSavingPerDiem] = useState(false);
  // MILES MUST BE USER-CORRECTABLE (owner decision 2026-08-05, FULL
  // PARITY follow-up item B.3) — miles is otherwise AI-extracted-only,
  // with no way to fix a misread total short of re-importing.
  const [milesDraft, setMilesDraft] = useState('');
  const [savingMiles, setSavingMiles] = useState(false);

  useEffect(() => {
    setPerDiemDraft(selected ? String(selected.per_diem_days ?? 0) : '');
    setMilesDraft(selected ? String(selected.miles ?? 0) : '');
  }, [selected]);

  async function handleSavePerDiem() {
    if (!selected) return;
    const days = clampPerDiemDays(Number(perDiemDraft) || 0);
    setSavingPerDiem(true);
    try {
      const updated = await updateSettlement.mutateAsync({ id: selected.id, values: { per_diem_days: days } });
      setSelected(updated);
      await invalidateFinancialData(queryClient);
    } catch (err) {
      Alert.alert(t('settlementsScreen.perDiemSaveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSavingPerDiem(false);
    }
  }

  async function handleSaveMiles() {
    if (!selected) return;
    const miles = Math.max(0, Number(milesDraft) || 0);
    setSavingMiles(true);
    try {
      const updated = await updateSettlement.mutateAsync({ id: selected.id, values: { miles } });
      setSelected(updated);
      await invalidateFinancialData(queryClient);
    } catch (err) {
      Alert.alert(t('settlementsScreen.milesSaveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSavingMiles(false);
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

  const documentsById = useMemo(
    () => new Map((documentsQuery.data ?? []).map((d) => [d.id, d])),
    [documentsQuery.data]
  );

  const allRows = useMemo(() => {
    const list = settlementsQuery.data ?? [];
    return [...list].sort((a, b) => b.week_ending.localeCompare(a.week_ending));
  }, [settlementsQuery.data]);
  const rows = useMemo(
    () => (needsReviewOnly ? allRows.filter((s) => isSettlementNeedsReview(s, documentsById)) : allRows),
    [allRows, needsReviewOnly, documentsById]
  );

  // "View linked records" from the Documents Archive viewer (owner decision
  // 2026-07-30) jumps here with ?openId=<settlementId> — auto-selects it
  // exactly once so re-selecting a fresh settlement later isn't overridden.
  useEffect(() => {
    const match = findRowToAutoOpen(allRows, openId, autoOpenedRef.current);
    if (match) {
      autoOpenedRef.current = true;
      setSelected(match);
    }
  }, [allRows, openId]);

  const chargebacks = useMemo(() => {
    if (!selected) return [];
    return (dedQuery.data ?? []).filter((d) => d.settlement_id === selected.id && d.source === 'settlement');
  }, [dedQuery.data, selected]);

  const settlementReimbursements = useMemo(() => {
    if (!selected) return [];
    return (reimbQuery.data ?? []).filter((r) => r.settlement_id === selected.id);
  }, [reimbQuery.data, selected]);

  const settlementLoads = useMemo(() => {
    if (!selected) return [];
    return (loadsQuery.data ?? []).filter((l) => l.settlement_id === selected.id);
  }, [loadsQuery.data, selected]);

  const revenueItems = useMemo(() => {
    if (!selected?.document_id) return [];
    const doc = (documentsQuery.data ?? []).find((d) => d.id === selected.document_id);
    return extractRevenueItems(doc?.parsed_json);
  }, [documentsQuery.data, selected]);

  const chargebackTotal = useMemo(() => chargebacks.reduce((sum, x) => sum + Number(x.amount ?? 0), 0), [chargebacks]);
  const reimbTotal = useMemo(
    () => settlementReimbursements.reduce((sum, x) => sum + Number(x.amount ?? 0), 0),
    [settlementReimbursements]
  );

  // Fleet-wide top stat row (FEATURE_INVENTORY.md §1 row 3: legacy's rSett()
  // shows Gross/Reimbursed/Deductions/Net) — scoped to settlement-linked rows
  // only (settlement_id set), same scoping as the per-settlement detail sheet
  // above, not the whole out-of-pocket ledger.
  const allSettlementReimbTotal = useMemo(
    () => (reimbQuery.data ?? []).filter((r) => r.settlement_id != null).reduce((sum, x) => sum + Number(x.amount ?? 0), 0),
    [reimbQuery.data]
  );
  const allSettlementDedTotal = useMemo(
    () =>
      (dedQuery.data ?? [])
        .filter((d) => d.settlement_id != null && d.source === 'settlement')
        .reduce((sum, x) => sum + Number(x.amount ?? 0), 0),
    [dedQuery.data]
  );
  // ESCROW & DEPOSITS running balance (owner decision 2026-08-02): what
  // the carrier currently HOLDS — a performance bond/escrow reserve/tire
  // fund/emergency fund/maintenance reserve is a refundable deposit, not
  // an expense, so it's tracked separately from allSettlementDedTotal
  // above (which still includes it, since it genuinely was withheld from
  // pay — just never counted against true profit/tax deductions).
  const escrowBalance = useMemo(() => calcEscrowBalance(dedQuery.data ?? []), [dedQuery.data]);

  // PAYMENT + DESTINATION SUMMARY (owner decision 2026-08-24, device
  // testing round, item 2) — the SAME shared findLinkedRecords()/
  // DestinationSummary the Documents viewer uses, so a settlement's own
  // "where it landed" summary can never disagree with what the Documents
  // Archive shows for that same document.
  const linkedRecords = useMemo(() => {
    if (!selected?.document_id) return [];
    return findLinkedRecords(selected.document_id, {
      settlements: settlementsQuery.data,
      deductions: dedQuery.data,
      maintenanceRecords: maintenanceQuery.data,
      fuelPurchases: fuelQuery.data,
      loads: loadsQuery.data,
      reimbursements: reimbQuery.data,
    });
  }, [selected, settlementsQuery.data, dedQuery.data, maintenanceQuery.data, fuelQuery.data, loadsQuery.data, reimbQuery.data]);

  // A settlement itself has no payment_method column (it's a carrier
  // deposit, not a payment the user chose) — the payment row is only shown
  // when the settlement maps to EXACTLY ONE withheld deduction, same rule
  // Documents Archive uses for a purchase receipt.
  const singleLinkedDeduction = useMemo(() => {
    const deductionRefs = linkedRecords.filter((r) => r.kind === 'deduction');
    if (deductionRefs.length !== 1) return null;
    return (dedQuery.data ?? []).find((d) => d.id === deductionRefs[0].id) ?? null;
  }, [linkedRecords, dedQuery.data]);

  function handleOpenLinkedRecord(ref: LinkedRecordRef) {
    setSelected(null);
    router.push(buildLinkedRecordHref(ref));
  }

  async function handleChangeDeductionCategory(deductionId: string, category: string) {
    try {
      await updateDeduction.mutateAsync({ id: deductionId, values: { category } });
      await invalidateFinancialData(queryClient);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    }
  }

  async function handleChangePaymentMethod(method: string) {
    if (!singleLinkedDeduction) return;
    setSavingPayment(true);
    try {
      await updateDeduction.mutateAsync({ id: singleLinkedDeduction.id, values: { payment_method: method } });
      await invalidateFinancialData(queryClient);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSavingPayment(false);
    }
  }

  // NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24, device
  // testing round): a settlement's own "needs review" status comes from
  // its LINKED DOCUMENT (needsReview.ts's isSettlementNeedsReview) — so
  // marking it reviewed marks that document reviewed.
  async function handleMarkReviewed(x: Settlement) {
    if (!x.document_id) return;
    setReviewingId(x.id);
    try {
      await markDocumentReviewed.mutateAsync(x.document_id);
      await invalidateFinancialData(queryClient);
    } catch (err) {
      Alert.alert(t('settlementsScreen.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setReviewingId(null);
    }
  }

  // Bulk "Mark all reviewed" (item 1) — operates on whatever's currently
  // filtered into `rows`, deduping by document_id in case two settlements
  // somehow shared one (they never do in practice, but this stays correct
  // either way instead of double-marking the same document).
  async function handleMarkAllReviewed() {
    const documentIds = [...new Set(rows.filter((s) => isSettlementNeedsReview(s, documentsById)).map((s) => s.document_id).filter((id): id is string => !!id))];
    if (documentIds.length === 0) return;
    setMarkingAllReviewed(true);
    try {
      await Promise.allSettled(documentIds.map((id) => markDocumentReviewed.mutateAsync(id)));
      await invalidateFinancialData(queryClient);
    } finally {
      setMarkingAllReviewed(false);
    }
  }

  function handleDelete(x: Settlement) {
    Alert.alert(t('settlementsScreen.deleteConfirmTitle'), t('settlementsScreen.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            // loads/fuel_purchases/reimbursements/deductions with this
            // settlement_id cascade-delete server-side (CLAUDE.md invariant #5).
            await deleteSettlement.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
            setSelected(null);
          } catch (err) {
            Alert.alert(t('settlementsScreen.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('settlementsScreen.title')}</ScreenTitle>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('settlementsScreen.grossTotal')}</MutedText>
              <Text style={styles.statValue}>{money(fleetStats.data?.grossRevenue ?? 0)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('settlementsScreen.reimbTotal')}</MutedText>
              <Text style={styles.statValue}>{money(allSettlementReimbTotal)}</Text>
            </View>
          </View>
          <View style={[styles.statRow, { marginTop: spacing.sm }]}>
            <View style={styles.statCell}>
              <MutedText>{t('settlementsScreen.dedTotal')}</MutedText>
              <Text style={styles.statValue}>{money(allSettlementDedTotal)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('settlementsScreen.netTotal')}</MutedText>
              <Text style={styles.statValue}>{money(fleetStats.data?.netRevenue ?? 0)}</Text>
            </View>
          </View>
        </Card>

        {escrowBalance > 0 && (
          <Card>
            <MutedText>{t('settlementsScreen.escrowHeldLabel')}</MutedText>
            <Text style={styles.statValue}>{money(escrowBalance)}</Text>
            <MutedText>{t('settlementsScreen.escrowHeldNote')}</MutedText>
          </Card>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
          <Pill
            label={t('needsReview.filterOnly')}
            selected={needsReviewOnly}
            onPress={() => setNeedsReviewOnly((v) => !v)}
          />
          {needsReviewOnly && rows.length > 0 && (
            <Pressable onPress={handleMarkAllReviewed} disabled={markingAllReviewed} hitSlop={8} style={{ marginStart: spacing.sm }}>
              <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
                {markingAllReviewed ? t('needsReview.markingAll') : t('needsReview.markAllReviewed')}
              </Text>
            </Pressable>
          )}
        </View>

        <MonthGroupedList
          screenKey="settlements"
          rows={rows}
          getDate={(x) => x.week_ending}
          getAmount={(x) => x.net}
          loading={settlementsQuery.isLoading}
          loadingLabel={t('common.loading')}
          emptyLabel={t('settlementsScreen.empty')}
          renderRows={(monthRows) =>
            monthRows.map((x) => {
              const needsReview = isSettlementNeedsReview(x, documentsById);
              return (
                <TappableCard key={x.id} onPress={() => setSelected(x)} style={needsReviewRowStyle(needsReview)}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View>
                      <Text style={styles.desc}>{t('settlementsScreen.weekOf', { date: date(x.week_ending) })}</Text>
                      <MutedText style={!x.miles ? { color: colors.orange, fontWeight: '700' } : undefined}>
                        {!x.miles ? `⚠️ ${t('settlementsScreen.milesMissing')}` : `${number(x.miles)} mi`}
                      </MutedText>
                      {/* UX MEGA-PASS item H: the per-settlement day count
                          breakdown visible at a glance in the list, not just
                          after tapping into the detail sheet. */}
                      <MutedText>{t('settlementsScreen.perDiemDaysCount', { count: x.per_diem_days ?? 0 })}</MutedText>
                      {needsReview && <NeedsReviewChip />}
                      {needsReview && (
                        <MarkReviewedButton onPress={() => handleMarkReviewed(x)} isPending={reviewingId === x.id} />
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {/* NEGATIVE SETTLEMENTS (owner decision 2026-08-02):
                          a losing week (net < 0, e.g. heavy chargebacks
                          against a low/zero-mile week) is real money owed
                          BACK to the carrier — shown in red with an
                          explicit label rather than looking like an
                          ordinary (smaller) payout. */}
                      <Text style={[styles.amount, x.net < 0 && { color: colors.red }]}>{money(x.net)}</Text>
                      {x.net < 0 ? (
                        <MutedText style={{ color: colors.red }}>{t('settlementsScreen.oweCarrier')}</MutedText>
                      ) : (
                        <MutedText>{t('settlementsScreen.grossLabel', { amount: money(x.gross) })}</MutedText>
                      )}
                    </View>
                  </View>
                </TappableCard>
              );
            })
          }
        />
      </ScrollView>

      <ModalSheet visible={!!selected} onClose={() => setSelected(null)}>
        {selected && (
            <>
              <SheetTitle>{t('settlementsScreen.weekOf', { date: date(selected.week_ending) })}</SheetTitle>
              {isSettlementNeedsReview(selected, documentsById) && (
                <View style={{ marginBottom: spacing.xs }}>
                  <NeedsReviewChip />
                  <MarkReviewedButton onPress={() => handleMarkReviewed(selected)} isPending={reviewingId === selected.id} />
                </View>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <View>
                  <MutedText>{t('settlementsScreen.grossLabelShort')}</MutedText>
                  <Text style={styles.detailAmount}>{money(selected.gross)}</Text>
                </View>
                <View>
                  <MutedText>{t('settlementsScreen.netLabelShort')}</MutedText>
                  <Text style={[styles.detailAmount, selected.net < 0 && { color: colors.red }]}>{money(selected.net)}</Text>
                  {selected.net < 0 && <MutedText style={{ color: colors.red }}>{t('settlementsScreen.oweCarrier')}</MutedText>}
                </View>
                <View>
                  <MutedText>{t('settlementsScreen.milesLabelShort')}</MutedText>
                  <Text style={styles.detailAmount}>{number(selected.miles ?? 0)}</Text>
                </View>
              </View>

              <View style={{ marginBottom: spacing.sm }}>
                <MutedText style={!selected.miles ? { color: colors.orange, fontWeight: '700' } : undefined}>
                  {!selected.miles ? `⚠️ ${t('settlementsScreen.milesEditLabelMissing')}` : t('settlementsScreen.milesEditLabel')}
                </MutedText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ width: 100 }}>
                    <Field keyboardType="numeric" value={milesDraft} onChangeText={setMilesDraft} placeholder="0" />
                  </View>
                  <SecondaryButton
                    title={t('common.save')}
                    onPress={handleSaveMiles}
                    loading={savingMiles}
                    disabled={milesDraft === String(selected.miles ?? 0)}
                  />
                </View>
              </View>

              <View style={{ marginBottom: spacing.sm }}>
                <MutedText>{t('settlementsScreen.perDiemDaysLabel')}</MutedText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ width: 80 }}>
                    <Field keyboardType="numeric" value={perDiemDraft} onChangeText={setPerDiemDraft} placeholder="0-7" />
                  </View>
                  <SecondaryButton
                    title={t('common.save')}
                    onPress={handleSavePerDiem}
                    loading={savingPerDiem}
                    disabled={perDiemDraft === String(selected.per_diem_days ?? 0)}
                  />
                </View>
              </View>

              {revenueItems.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>{t('settlementsScreen.incomeLines')}</Text>
                  {revenueItems.map((item, i) => (
                    <View key={i} style={styles.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailDesc}>{item.desc ?? item.order ?? '—'}</Text>
                        {item.incomeType && <MutedText>{item.incomeType.replace(/_/g, ' ')}</MutedText>}
                      </View>
                      <Text style={styles.detailDesc}>{money(item.amount ?? 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              <Text style={styles.sectionTitle}>
                {t('settlementsScreen.chargebacks')} · {money(chargebackTotal)}
              </Text>
              {chargebacks.length === 0 ? (
                <MutedText>{t('settlementsScreen.noChargebacks')}</MutedText>
              ) : (
                chargebacks.map((d) => (
                  <View key={d.id} style={styles.detailRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailDesc}>{d.description ?? d.category ?? '—'}</Text>
                      {d.category && <MutedText>{d.category}</MutedText>}
                    </View>
                    <Text style={styles.detailDesc}>{money(d.amount)}</Text>
                  </View>
                ))
              )}

              {settlementReimbursements.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>
                    {t('settlementsScreen.reimbursements')} · {money(reimbTotal)}
                  </Text>
                  {settlementReimbursements.map((r) => (
                    <View key={r.id} style={styles.detailRow}>
                      <Text style={styles.detailDesc}>{r.description ?? '—'}</Text>
                      <Text style={styles.detailDesc}>{money(r.amount ?? 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              {settlementLoads.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>{t('settlementsScreen.loads')}</Text>
                  {settlementLoads.map((l) => (
                    <View key={l.id} style={styles.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailDesc}>
                          {l.origin ?? '—'} → {l.destination ?? '—'}
                        </Text>
                        <MutedText>{number(l.loaded_miles ?? 0)} mi</MutedText>
                      </View>
                      <Text style={styles.detailDesc}>{money(l.revenue ?? 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              <View style={styles.reimportNote}>
                <Text style={{ color: colors.muted, fontSize: typography.size.xs }}>
                  {t('settlementsScreen.reimportNote')}
                </Text>
              </View>

              {selected.document_id && (
                <SecondaryButton
                  title={`📄 ${t('common.viewOriginalDocument')}`}
                  onPress={() => {
                    const documentId = selected.document_id as string;
                    setSelected(null);
                    router.push({ pathname: '/(tabs)/more/documents', params: { openId: documentId } } as unknown as Href);
                  }}
                />
              )}

              <DestinationSummary
                refs={linkedRecords}
                onOpenRef={handleOpenLinkedRecord}
                payment={
                  singleLinkedDeduction
                    ? {
                        method: singleLinkedDeduction.payment_method,
                        onChangeMethod: handleChangePaymentMethod,
                        saving: savingPayment,
                      }
                    : null
                }
                onChangeDeductionCategory={handleChangeDeductionCategory}
              />

            <SecondaryButton title={`🗑 ${t('common.delete')}`} onPress={() => handleDelete(selected)} />
            <SecondaryButton title={t('common.cancel')} onPress={() => setSelected(null)} />
          </>
        )}
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  statRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  desc: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '600' as const,
  },
  amount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailDesc: {
    color: colors.text,
    fontSize: typography.size.sm,
  },
  detailAmount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  reimportNote: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
};
