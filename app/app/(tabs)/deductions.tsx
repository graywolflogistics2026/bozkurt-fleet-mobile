import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useDeductions, useDeleteDeduction } from '@/src/data/deductions';
import {
  fetchLinkedContributionId,
  cleanupOrphanedDocument,
  updateDeductionWithContributionSync,
  insertDeductionWithContributionSync,
} from '@/src/data/deductionMutations';
import { fetchReimbursementStatus, useReimburseMyself } from '@/src/data/capitalTransactions';
import type { ReimbursementStatus } from '@/src/stats/capitalAccount';
import { useLearnCategoryCorrection, fetchCarrierForDeduction } from '@/src/data/categoryLearningRules';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useMarkDeductionReviewed, useMarkAllDeductionsReviewed } from '@/src/data/needsReviewMutations';
import { MonthGroupedList } from '@/src/components/monthGroups/MonthGroupedList';
import { needsReviewRowStyle, NeedsReviewChip, MarkReviewedButton } from '@/src/components/NeedsReviewBadge';
import { isDeductionNeedsReview } from '@/src/import/needsReview';
import { groupDeductions } from '@/src/stats/deductionGroups';
import {
  buildDeductionsTotalsBar,
  buildDeductionsChartSeries,
  buildTopCategories,
  toggleDeductionSeries,
  type OriginFilter,
} from '@/src/stats/deductionsSummary';
import { PERIOD_OPTIONS, filterByPeriod, type PeriodOption } from '@/src/stats/periodFilter';
import { buildPolylinePoints } from '@/src/stats/chartHelpers';
import { useSessionState } from '@/src/lib/useSessionState';
import { planContributionSync } from '@/src/stats/contributionSync';
import { defaultTaxDeductible } from '@/src/import/category';
import { findRowToAutoOpen } from '@/src/navigation/autoOpenParam';
import { isPersonalPayment, normalizePaymentMethod, PAYMENT_METHODS, type PaymentMethod } from '@/src/import/paymentMethods';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { useFormatters } from '@/src/i18n/format';
import { CategoryPicker } from '@/src/components/CategoryPicker';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { Deduction } from '@/src/types/db';

const CHART_HEIGHT = 100;

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

// TWO TOGGLEABLE SERIES (spec item 2c) — thin-line "Apple Stocks style"
// chart, same buildPolylinePoints() primitive every other chart in this
// app already uses (CLAUDE.md's CHART LANGUAGE CONSISTENCY invariant) —
// never a thick bar. Both series share one Y domain so their relative
// size is honestly comparable at a glance. `showOutOfPocket`/
// `showWithheld` only control which line(s) are DRAWN — the underlying
// bucket data always has both, so toggling never re-fetches or re-buckets
// anything.
function DeductionsChart({
  buckets,
  showOutOfPocket,
  showWithheld,
}: {
  buckets: { key: string; outOfPocket: number; withheld: number }[];
  showOutOfPocket: boolean;
  showWithheld: boolean;
}) {
  const [width, setWidth] = useState(0);
  const height = CHART_HEIGHT;
  const oopValues = buckets.map((b) => b.outOfPocket);
  const whValues = buckets.map((b) => b.withheld);
  const domain: [number, number] = [0, Math.max(0, ...oopValues, ...whValues)];
  const oopLine = buildPolylinePoints(oopValues, width, height, domain);
  const whLine = buildPolylinePoints(whValues, width, height, domain);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {showOutOfPocket && <Polyline points={oopLine} fill="none" stroke={colors.accent} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
          {showWithheld && <Polyline points={whLine} fill="none" stroke={colors.purple} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
        </Svg>
      )}
    </View>
  );
}

function TotalsTile({ label, amount, count, selected, onPress }: { label: string; amount: number; count?: number; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  return (
    <Pressable onPress={onPress} style={[styles.totalsTile, selected && styles.totalsTileSelected]}>
      <MutedText numberOfLines={1}>{label}</MutedText>
      <Text style={styles.totalsTileAmount} numberOfLines={1}>
        {money(amount)}
      </Text>
      {count != null && <MutedText>{t('deductions.totalsTileItemCount', { count })}</MutedText>}
    </Pressable>
  );
}

function DedRow({
  x,
  onPress,
  onDelete,
  onMarkReviewed,
  markReviewedPending,
}: {
  x: Deduction;
  onPress: () => void;
  onDelete: () => void;
  onMarkReviewed: () => void;
  markReviewedPending: boolean;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const personal = isPersonalPayment(x.payment_method);
  const needsReview = isDeductionNeedsReview(x);
  return (
    <Pressable onPress={onPress} style={[styles.row, needsReviewRowStyle(needsReview)]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={2}>
          {x.description ?? '—'}
        </Text>
        <MutedText>
          {x.ded_date ?? '—'} · {x.category ?? '—'}
          {x.store ? ` · ${x.store}` : ''}
        </MutedText>
        <Text style={{ color: personal ? colors.orange : colors.muted, fontSize: typography.size.xs, marginTop: 2 }}>
          {x.payment_method ?? '—'}
          {personal ? ` ${t('deductions.personalContributionTag')}` : ''}
        </Text>
        {x.tax_deductible === false && (
          <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginTop: 2, fontWeight: '700' }}>
            {t('deductions.nonDeductibleTag')}
          </Text>
        )}
        {needsReview && <NeedsReviewChip />}
        {needsReview && <MarkReviewedButton onPress={onMarkReviewed} isPending={markReviewedPending} />}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.amount)}</Text>
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function DedSection({
  screenKey,
  title,
  subtitle,
  rows,
  total,
  emptyLabel,
  onEdit,
  onDelete,
  onMarkReviewed,
  reviewingId,
  markReviewedPending,
}: {
  screenKey: string;
  title: string;
  subtitle: string;
  rows: Deduction[];
  total: number;
  emptyLabel: string;
  onEdit: (x: Deduction) => void;
  onDelete: (x: Deduction) => void;
  onMarkReviewed: (x: Deduction) => void;
  reviewingId: string | null;
  markReviewedPending: boolean;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  return (
    <>
      <View style={{ marginBottom: spacing.xs }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <MutedText>{subtitle}</MutedText>
      </View>
      {rows.length > 0 && (
        <View style={[styles.row, styles.totalRow, { marginBottom: spacing.xs }]}>
          <Text style={styles.totalLabel}>{t('deductions.total')}</Text>
          <Text style={styles.totalAmount}>{money(total)}</Text>
        </View>
      )}
      <MonthGroupedList
        screenKey={screenKey}
        rows={rows}
        getDate={(x) => x.ded_date}
        getAmount={(x) => x.amount}
        loadingLabel={t('common.loading')}
        emptyLabel={emptyLabel}
        renderRows={(monthRows) => (
          <Card>
            {monthRows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <DedRow
                  x={x}
                  onPress={() => onEdit(x)}
                  onDelete={() => onDelete(x)}
                  onMarkReviewed={() => onMarkReviewed(x)}
                  markReviewedPending={markReviewedPending && reviewingId === x.id}
                />
              </View>
            ))}
          </Card>
        )}
      />
    </>
  );
}

export default function Deductions() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const { openId, filter } = useLocalSearchParams<{ openId?: string; filter?: string }>();
  // BETA FEEDBACK ROUND 2: Home's needs-review counter chip links here
  // with ?filter=needsReview to land with the toggle already on.
  const [needsReviewOnly, setNeedsReviewOnly] = useState(filter === 'needsReview');
  // Segmented origin filter (owner decision 2026-08-05, FULL PARITY pass
  // item F.3) — the SAME origin rule Part B's Accountant Package screen
  // uses (a settlement-withheld row is never out-of-pocket): "All" keeps
  // showing both sections stacked (unchanged default behavior); the other
  // two options show ONLY that section, letting a user quickly answer
  // "what did I pay out of pocket this month" without scrolling past the
  // withheld section (or vice versa).
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  // TOTALS + CHARTS (owner decision, "period tabs" pass) — period is
  // "remembered for the session" (spec item 2b), same module-level-Map
  // pattern useMonthCollapse.ts already established for month-group
  // collapse state; a category tap (top-3 list, spec item 2d) drills the
  // list/chart down further without disturbing the origin/period state.
  const [period, setPeriod] = useSessionState<PeriodOption>('deductions-period', 'all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const autoOpenedRef = useRef(false);
  const dedQuery = useDeductions();
  const learnCategoryCorrection = useLearnCategoryCorrection();
  const deleteDeduction = useDeleteDeduction();
  const reimburseMyself = useReimburseMyself();
  const markReviewed = useMarkDeductionReviewed();
  const markAllReviewed = useMarkAllDeductionsReviewed();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<Deduction | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editPayment, setEditPayment] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editTaxDeductible, setEditTaxDeductible] = useState(true);
  const [saving, setSaving] = useState(false);
  // PAYMENT SOURCE & CAPITAL CLARITY (owner decision 2026-08-24, FIVE
  // ADDITIONS pass, PART 2 item 1) — fetched fresh each time the edit sheet
  // opens for an owner-paid row (a per-row fetch on every list render would
  // be wasteful; this screen already only needs the status for whichever
  // ONE row is currently open).
  const [reimbursementStatus, setReimbursementStatus] = useState<ReimbursementStatus | null>(null);
  const [reimbursing, setReimbursing] = useState(false);

  const [adding, setAdding] = useState(false);
  const [addDescription, setAddDescription] = useState('');
  const [addCategory, setAddCategory] = useState('Misc');
  const [addPayment, setAddPayment] = useState<PaymentMethod>(PAYMENT_METHODS[0]);
  const [addAmount, setAddAmount] = useState('');
  const [addDate, setAddDate] = useState('');
  const [addTaxDeductible, setAddTaxDeductible] = useState(true);
  const [addSaving, setAddSaving] = useState(false);

  // Meals & advance repayments (owner decision 2026-07-17): a smart default
  // from the picked category, recomputed only while the row is still being
  // composed (new "add" flow) — never re-applied to an EXISTING row just
  // because its category changed, so a user's own deliberate edit sticks.
  function handleAddCategoryChange(category: string) {
    setAddCategory(category);
    setAddTaxDeductible(defaultTaxDeductible(category));
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Pull-to-refresh is an explicit "make sure everything here is
      // current" gesture, not a mutation — keep the full unscoped sweep.
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const allRows = dedQuery.data ?? [];
  // PERIOD TABS (spec item 2b) drive the totals bar, chart, and list
  // together — period-filtered first, then needs-review, matching the
  // pre-existing filter order. `totalsBarRows` (origin-inclusive) is what
  // the totals bar / top-3-categories / chart read from, so tapping a
  // totals-bar tile (which only sets `originFilter`, isolating which
  // SECTION renders below) never changes the totals bar's own numbers — a
  // tile always reflects the whole selected period. A category tap
  // narrows `rows` (and therefore the visible sections + chart) one step
  // further without touching the totals bar.
  const periodRows = useMemo(() => filterByPeriod(allRows, (x) => x.ded_date, period), [allRows, period]);
  const totalsBarRows = useMemo(
    () => (needsReviewOnly ? periodRows.filter(isDeductionNeedsReview) : periodRows),
    [periodRows, needsReviewOnly]
  );
  const rows = useMemo(
    () => (categoryFilter ? totalsBarRows.filter((x) => (x.category || 'Misc') === categoryFilter) : totalsBarRows),
    [totalsBarRows, categoryFilter]
  );
  const { outOfPocket, withheld, outOfPocketTotal, withheldTotal } = useMemo(() => groupDeductions(rows), [rows]);
  const totalsBar = useMemo(() => buildDeductionsTotalsBar(totalsBarRows), [totalsBarRows]);
  const topCategories = useMemo(() => buildTopCategories(totalsBarRows), [totalsBarRows]);
  const chartBuckets = useMemo(() => buildDeductionsChartSeries(rows, period), [rows, period]);
  const showOutOfPocketLine = originFilter !== 'withheld';
  const showWithheldLine = originFilter !== 'outOfPocket';
  // "Label them explicitly for YTD/All" (spec item 2a) — This Month/3M
  // need no extra suffix (the period Pill selection above already makes
  // the window obvious); YTD/All are the two periods where "which years's
  // worth of data am I looking at" genuinely needs spelling out.
  const now = useMemo(() => new Date(), []);
  const periodSuffix = period === 'ytd' ? ` ${now.getFullYear()}` : period === 'all' ? ` ${t('deductions.allTimeSuffix')}` : '';

  function openEdit(x: Deduction) {
    setEditing(x);
    // Custom categories (CLAUDE.md invariant #19) are valid values here too
    // now — only an empty/never-set category falls back to "Misc".
    setEditCategory(x.category || 'Misc');
    setEditPayment(normalizePaymentMethod(x.payment_method));
    setEditAmount(String(x.amount ?? 0));
    setEditTaxDeductible(x.tax_deductible !== false);
    setReimbursementStatus(null);
    if (userId) {
      fetchReimbursementStatus(userId, x.id)
        .then(setReimbursementStatus)
        .catch(() => setReimbursementStatus(null));
    }
  }

  function closeEdit() {
    setEditing(null);
    setReimbursementStatus(null);
  }

  // TWO DISAGREEING "does this reduce income" RULES (P1 fix, FULL SYSTEM
  // AUDIT) — mirrors handleAddCategoryChange()'s own existing pattern
  // (recompute the smart default while the row is still being composed)
  // extended to editing: previously only the ADD flow recomputed
  // tax_deductible from the newly-picked category; re-categorizing an
  // EXISTING row left tax_deductible exactly whatever it was before,
  // silently disagreeing with reducesTrueProfit()'s own category-based
  // exclusion (a row moved to "Meals (per diem covered)"/"Advance
  // Repayment"/"Escrow & Deposits" was excluded from true profit but
  // still counted as a real deductible expense in the tax estimate,
  // understating tax owed). This is still a SMART DEFAULT, not a lock —
  // the checkbox right below the category picker stays independently
  // togglable after this recompute, exactly like the add flow.
  function handleEditCategoryChange(category: string) {
    setEditCategory(category);
    setEditTaxDeductible(defaultTaxDeductible(category));
  }

  async function handleReimburseMyself() {
    if (!editing || !userId || !reimbursementStatus || reimbursementStatus.outstandingAmount <= 0) return;
    setReimbursing(true);
    try {
      await reimburseMyself.mutateAsync({
        userId,
        deductionId: editing.id,
        amount: reimbursementStatus.outstandingAmount,
        note: `${(editing.description ?? 'Deduction').split(' — ')[0]} — reimbursed to owner`,
      });
      const refreshed = await fetchReimbursementStatus(userId, editing.id);
      setReimbursementStatus(refreshed);
      // reimburseMyself.mutateAsync() already invalidates capital_transactions/
      // capital-account-summary/profile internally (capitalTransactions.ts) —
      // this call only needs to additionally cover 'capital_transactions' in
      // case a screen reads it through a differently-shaped query; scoped
      // rather than the full ~28-table sweep.
      await invalidateFinancialData(queryClient, { entities: ['capital_transactions'] });
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setReimbursing(false);
    }
  }

  // NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24, device
  // testing round): the ONE mutation that ever writes reviewed_at for a
  // deduction. Closes the edit sheet too when called from there, since a
  // reviewed row's needsReview flag flips false and the sheet's own
  // "Mark reviewed" control disappears out from under the user otherwise.
  async function handleMarkReviewed(x: Deduction, closeAfter?: boolean) {
    setReviewingId(x.id);
    try {
      await markReviewed.mutateAsync({ id: x.id, description: x.description });
      await invalidateFinancialData(queryClient, { entities: ['deductions'] });
      if (closeAfter) closeEdit();
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setReviewingId(null);
    }
  }

  // Bulk "Mark all reviewed" (item 1) — operates on whatever's currently
  // visible in `rows` while the needsReviewOnly filter is on, so it can
  // never mark a row the user hasn't actually filtered down to.
  async function handleMarkAllReviewed() {
    const target = rows.filter(isDeductionNeedsReview);
    if (target.length === 0) return;
    try {
      await markAllReviewed.mutateAsync(target.map((d) => ({ id: d.id, description: d.description })));
      await invalidateFinancialData(queryClient, { entities: ['deductions'] });
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    }
  }

  // "View linked records" from the Documents Archive viewer (owner decision
  // 2026-07-30) jumps here with ?openId=<deductionId> — auto-opens it
  // exactly once (findRowToAutoOpen's "already opened" guard).
  useEffect(() => {
    const match = findRowToAutoOpen(allRows, openId, autoOpenedRef.current);
    if (match) {
      autoOpenedRef.current = true;
      openEdit(match);
    }
  }, [allRows, openId]);

  async function handleSaveEdit() {
    if (!editing || !userId) return;
    const amount = Number(editAmount) || 0;
    const personal = isPersonalPayment(editPayment);

    setSaving(true);
    try {
      const existingContributionId = await fetchLinkedContributionId(userId, editing.id);
      let plan = planContributionSync({
        isPersonal: personal,
        amount,
        date: editing.ded_date,
        description: editing.description,
        paymentMethod: editPayment,
        existingContributionId,
      });

      // CLAUDE.md invariant #2: a NEW contribution (none existed before)
      // only gets created after explicit confirmation. Updating/removing
      // an already-linked contribution is unconditional.
      if (plan.action === 'create') {
        const confirmed = await confirmOwnerContribution(editPayment);
        if (!confirmed) plan = { action: 'noop' };
      }

      // DEDUCTION EDIT + CONTRIBUTION SYNC NOT ATOMIC (P1 fix, FULL SYSTEM
      // AUDIT, docs/PENDING_SQL.md §62) — this used to be two separate
      // awaits (updateDeduction.mutateAsync() then applyContributionSync()),
      // so a network drop between them could leave the deduction saved
      // with a stale/missing/orphaned linked contribution. Now one atomic
      // RPC call — either both the deduction update and the contribution
      // sync happen, or neither does.
      await updateDeductionWithContributionSync({
        deductionId: editing.id,
        userId,
        category: editCategory,
        paymentMethod: editPayment,
        amount,
        taxDeductible: editTaxDeductible,
        plan,
      });
      // CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
      // follow-up item G) — a genuine manual re-categorization (the user
      // picked something DIFFERENT from what was already there, not just
      // re-saving the same value) teaches a keyword->category rule for
      // next time. Best-effort: never blocks the save on failure.
      // CARRIER-SCOPED PAYROLL/SETTLEMENT CODES pass (owner decision) — a
      // settlement-withheld row's own carrier (via its parent settlement)
      // scopes the learned rule to that carrier only; a standalone/
      // out-of-pocket row (no settlement_id) learns a universal rule,
      // same as before this pass.
      if (editCategory && editCategory !== (editing.category || 'Misc')) {
        const carrier = await fetchCarrierForDeduction(editing);
        learnCategoryCorrection.mutate({ userId, description: editing.description, category: editCategory, carrier });
      }
      // UNBOUNDED QUERIES / SCOPED INVALIDATION FIX (P0, FULL SYSTEM AUDIT
      // owner decision 2026-08-26) — the measured scenario: this save
      // always touches 'deductions'; the atomic RPC above may create/
      // update/remove a linked capital_transactions row (always run, even
      // when plan.action is 'noop') — including it unconditionally is
      // cheap and correct either way. Down from invalidating all ~28
      // tables + 4 aggregates (32 calls) to 5 — see
      // src/data/__tests__/queryInvalidation.test.ts's "EXACT reported
      // scenario" test for the measured before/after count.
      await invalidateFinancialData(queryClient, { entities: ['deductions', 'capital_transactions'] });
      setEditing(null);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function openAdd() {
    setAddDescription('');
    setAddCategory('Misc');
    setAddPayment(PAYMENT_METHODS[0]);
    setAddAmount('');
    setAddDate(new Date().toISOString().slice(0, 10));
    setAddTaxDeductible(true);
    setAdding(true);
  }

  function closeAdd() {
    setAdding(false);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amount = Number(addAmount) || 0;
    const personal = isPersonalPayment(addPayment);

    // CLAUDE.md invariant #2: a personal-payment purchase only creates a
    // linked capital contribution after explicit confirmation — same gate
    // as editing, asked once per save, not per line item.
    if (personal && amount > 0) {
      const confirmed = await confirmOwnerContribution(addPayment);
      if (!confirmed) return;
    }

    setAddSaving(true);
    try {
      // DEDUCTION EDIT + CONTRIBUTION SYNC NOT ATOMIC (P1 fix, FULL SYSTEM
      // AUDIT, docs/PENDING_SQL.md §62) — one atomic RPC insert instead of
      // insertDeduction.mutateAsync() followed by a separate
      // applyContributionSync() call, so a network drop between them can
      // no longer leave a personal-payment purchase saved with no linked
      // contribution. A brand-new row can never have an EXISTING linked
      // contribution to update/remove (existingContributionId is always
      // null here), so planContributionSync() can only ever return
      // 'create' or 'noop' for the add flow — reused here only to get the
      // exact same note-text formatting as before, not for its I/O.
      const createContribution = personal && amount > 0;
      const plan = createContribution
        ? planContributionSync({
            isPersonal: true,
            amount,
            date: addDate || null,
            description: addDescription || null,
            paymentMethod: addPayment,
            existingContributionId: null,
          })
        : null;

      await insertDeductionWithContributionSync({
        userId,
        description: addDescription || null,
        category: addCategory,
        paymentMethod: addPayment,
        amount,
        dedDate: addDate || null,
        taxDeductible: addTaxDeductible,
        createContribution,
        contributionNote: plan?.action === 'create' ? plan.note : undefined,
      });

      await invalidateFinancialData(queryClient, {
        entities: createContribution ? ['deductions', 'capital_transactions'] : ['deductions'],
      });
      setAdding(false);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setAddSaving(false);
    }
  }

  function handleDelete(x: Deduction) {
    Alert.alert(t('deductions.deleteConfirmTitle'), t('deductions.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            // Linked capital_transactions row cascades automatically
            // (docs/SCHEMA.sql: linked_deduction_id ... on delete cascade —
            // CLAUDE.md invariant #5).
            await deleteDeduction.mutateAsync(x.id);
            if (x.document_id) await cleanupOrphanedDocument(x.document_id);
            await invalidateFinancialData(queryClient, {
              entities: x.document_id ? ['deductions', 'capital_transactions', 'documents'] : ['deductions', 'capital_transactions'],
            });
          } catch (err) {
            Alert.alert(t('deductions.deleteFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('deductions.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
              + {t('deductions.add')}
            </Text>
          </Pressable>
        </View>

        {/* TOTALS BAR (spec item 2a) — three tappable tiles reflecting the
            selected period; tapping one is exactly equivalent to tapping
            the matching origin-filter Pill below (shared state). */}
        <View style={styles.totalsBarRow}>
          <TotalsTile
            label={`${t('deductions.totalsTileOutOfPocket')}${periodSuffix}`}
            amount={totalsBar.outOfPocket.amount}
            count={totalsBar.outOfPocket.count}
            selected={originFilter === 'outOfPocket'}
            onPress={() => setOriginFilter(originFilter === 'outOfPocket' ? 'all' : 'outOfPocket')}
          />
          <TotalsTile
            label={`${t('deductions.totalsTileWithheld')}${periodSuffix}`}
            amount={totalsBar.withheld.amount}
            count={totalsBar.withheld.count}
            selected={originFilter === 'withheld'}
            onPress={() => setOriginFilter(originFilter === 'withheld' ? 'all' : 'withheld')}
          />
          <TotalsTile
            label={`${t('deductions.totalsTileTotal')}${periodSuffix}`}
            amount={totalsBar.total.amount}
            selected={originFilter === 'all'}
            onPress={() => setOriginFilter('all')}
          />
        </View>
        {totalsBar.nonDeductibleAmount > 0 && (
          <MutedText style={{ marginBottom: spacing.sm }}>
            {t('deductions.totalsBarNonDeductibleCaption', { amount: money(totalsBar.nonDeductibleAmount) })}
          </MutedText>
        )}

        {/* PERIOD TABS (spec item 2b) — drives the totals bar, chart, and
            list together; remembered for the session. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          {PERIOD_OPTIONS.map((p) => (
            <Pill key={p} label={t(`deductions.period.${p}`)} selected={period === p} onPress={() => setPeriod(p)} />
          ))}
        </View>

        {/* CHART (spec item 2c) — two toggleable series sharing state with
            the origin filter; item 2f: fewer than 2 buckets shows the
            summary numbers above without a misleading chart. */}
        <Card>
          {chartBuckets.length >= 2 ? (
            <>
              <DeductionsChart buckets={chartBuckets} showOutOfPocket={showOutOfPocketLine} showWithheld={showWithheldLine} />
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                <Pressable
                  onPress={() => setOriginFilter(toggleDeductionSeries(originFilter, 'outOfPocket'))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <View style={{ width: 10, height: 2, backgroundColor: colors.accent, opacity: showOutOfPocketLine ? 1 : 0.3 }} />
                  <MutedText style={!showOutOfPocketLine ? { opacity: 0.5 } : undefined}>{t('deductions.originFilterOutOfPocket')}</MutedText>
                </Pressable>
                <Pressable
                  onPress={() => setOriginFilter(toggleDeductionSeries(originFilter, 'withheld'))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <View style={{ width: 10, height: 2, backgroundColor: colors.purple, opacity: showWithheldLine ? 1 : 0.3 }} />
                  <MutedText style={!showWithheldLine ? { opacity: 0.5 } : undefined}>{t('deductions.originFilterWithheld')}</MutedText>
                </Pressable>
              </View>
            </>
          ) : (
            <MutedText>{t('deductions.chartNotEnoughData')}</MutedText>
          )}
        </Card>

        {/* TOP CATEGORIES (spec item 2d) — tapping one filters the list. */}
        {topCategories.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>{t('deductions.topCategoriesTitle')}</Text>
            {topCategories.map((c, i) => (
              <Pressable
                key={c.category}
                onPress={() => setCategoryFilter((cur) => (cur === c.category ? null : c.category))}
                style={[styles.topCategoryRow, i > 0 ? styles.rowBorder : undefined]}
              >
                <Text style={[styles.topCategoryLabel, categoryFilter === c.category && { color: colors.accent }]} numberOfLines={1}>
                  {c.category}
                </Text>
                <Text style={{ color: colors.text }}>
                  {money(c.amount)} · {Math.round(c.share * 100)}%
                </Text>
              </Pressable>
            ))}
            {categoryFilter && (
              <Pressable onPress={() => setCategoryFilter(null)} hitSlop={8} style={{ marginTop: spacing.xs }}>
                <Text style={{ color: colors.accent, fontWeight: '700', fontSize: typography.size.sm }}>
                  ✕ {t('deductions.clearCategoryFilter')}
                </Text>
              </Pressable>
            )}
          </Card>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
          <Pill
            label={t('needsReview.filterOnly')}
            selected={needsReviewOnly}
            onPress={() => setNeedsReviewOnly((v) => !v)}
          />
          {needsReviewOnly && rows.length > 0 && (
            <Pressable onPress={handleMarkAllReviewed} disabled={markAllReviewed.isPending} hitSlop={8} style={{ marginStart: spacing.sm }}>
              <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
                {markAllReviewed.isPending ? t('needsReview.markingAll') : t('needsReview.markAllReviewed')}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          <Pill label={t('deductions.originFilterAll')} selected={originFilter === 'all'} onPress={() => setOriginFilter('all')} />
          <Pill
            label={t('deductions.originFilterOutOfPocket')}
            selected={originFilter === 'outOfPocket'}
            onPress={() => setOriginFilter('outOfPocket')}
          />
          <Pill
            label={t('deductions.originFilterWithheld')}
            selected={originFilter === 'withheld'}
            onPress={() => setOriginFilter('withheld')}
          />
        </View>

        {dedQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            {originFilter !== 'withheld' && (
              <DedSection
                screenKey="deductions-outOfPocket"
                title={t('deductions.outOfPocketTitle')}
                subtitle={t('deductions.outOfPocketSubtitle')}
                rows={outOfPocket}
                total={outOfPocketTotal}
                emptyLabel={t('deductions.outOfPocketEmpty')}
                onEdit={openEdit}
                onDelete={handleDelete}
                onMarkReviewed={handleMarkReviewed}
                reviewingId={reviewingId}
                markReviewedPending={markReviewed.isPending}
              />
            )}
            {originFilter !== 'outOfPocket' && (
              <DedSection
                screenKey="deductions-withheld"
                title={t('deductions.withheldTitle')}
                subtitle={t('deductions.withheldSubtitle')}
                rows={withheld}
                total={withheldTotal}
                emptyLabel={t('deductions.withheldEmpty')}
                onEdit={openEdit}
                onDelete={handleDelete}
                onMarkReviewed={handleMarkReviewed}
                reviewingId={reviewingId}
                markReviewedPending={markReviewed.isPending}
              />
            )}
          </>
        )}
      </ScrollView>

      <ModalSheet visible={!!editing} onClose={closeEdit}>
        <SheetTitle>{t('deductions.editTitle')}</SheetTitle>
        {editing && (
          <MutedText>
            {(editing.description ?? 'Deduction').split(' — ')[0]} — {money(editing.amount)}
          </MutedText>
        )}
        {editing && isDeductionNeedsReview(editing) && (
          <View style={{ marginTop: spacing.sm }}>
            <NeedsReviewChip />
            <MarkReviewedButton
              onPress={() => handleMarkReviewed(editing, true)}
              isPending={markReviewed.isPending && reviewingId === editing.id}
            />
          </View>
        )}

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.categoryLabel')}</MutedText>
        </View>
        <CategoryPicker kind="expense" value={editCategory} onChange={handleEditCategoryChange} />

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.taxDeductibleLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Pill label={t('deductions.taxDeductibleYes')} selected={editTaxDeductible} onPress={() => setEditTaxDeductible(true)} />
          <Pill label={t('deductions.taxDeductibleNo')} selected={!editTaxDeductible} onPress={() => setEditTaxDeductible(false)} />
        </View>

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.amountLabel')}</MutedText>
        </View>
        <Field keyboardType="numeric" value={editAmount} onChangeText={setEditAmount} placeholder="0.00" />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.paymentMethodLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PAYMENT_METHODS.map((p) => (
            <Pill key={p} label={p} selected={editPayment === p} onPress={() => setEditPayment(p)} />
          ))}
        </View>

        {isPersonalPayment(editPayment) && (
          <View
            style={{
              marginTop: spacing.md,
              padding: spacing.sm,
              borderRadius: radii.sm,
              backgroundColor: 'rgba(245,158,11,0.12)',
            }}
          >
            <Text style={{ color: colors.orange, fontSize: typography.size.xs }}>
              {t('deductions.personalPaymentNote')}
            </Text>
          </View>
        )}

        {/* PAYMENT SOURCE & CAPITAL CLARITY (owner decision 2026-08-24, FIVE
            ADDITIONS pass, PART 2 item 1) — only shown for an owner-paid row
            that actually has a linked contribution (reimbursementStatus is
            null for a business-paid row, or one whose contribution the
            owner declined at import time). */}
        {reimbursementStatus && (
          <View style={{ marginTop: spacing.sm }}>
            <MutedText>
              {reimbursementStatus.fullyReimbursed
                ? t('deductions.reimbursedInFull', { amount: money(reimbursementStatus.contributionAmount) })
                : reimbursementStatus.reimbursedAmount > 0
                  ? t('deductions.reimbursedPartial', {
                      reimbursed: money(reimbursementStatus.reimbursedAmount),
                      total: money(reimbursementStatus.contributionAmount),
                    })
                  : t('deductions.notYetReimbursed')}
            </MutedText>
            {!reimbursementStatus.fullyReimbursed && (
              <SecondaryButton
                title={`💰 ${t('deductions.reimburseMyself', { amount: money(reimbursementStatus.outstandingAmount) })}`}
                onPress={handleReimburseMyself}
                loading={reimbursing}
              />
            )}
          </View>
        )}

        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveEdit} loading={saving} />
        {editing?.document_id && (
          <SecondaryButton
            title={`📄 ${t('common.viewOriginalDocument')}`}
            onPress={() => {
              const documentId = editing.document_id as string;
              closeEdit();
              router.push({ pathname: '/(tabs)/more/documents', params: { openId: documentId } } as unknown as Href);
            }}
          />
        )}
        <SecondaryButton title={t('common.cancel')} onPress={closeEdit} />
      </ModalSheet>

      <ModalSheet visible={adding} onClose={closeAdd}>
        <SheetTitle>{t('deductions.addTitle')}</SheetTitle>

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.descriptionLabel')}</MutedText>
        </View>
        <Field value={addDescription} onChangeText={setAddDescription} placeholder={t('deductions.descriptionPlaceholder')} />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.categoryLabel')}</MutedText>
        </View>
        <CategoryPicker kind="expense" value={addCategory} onChange={handleAddCategoryChange} />

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.taxDeductibleLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Pill label={t('deductions.taxDeductibleYes')} selected={addTaxDeductible} onPress={() => setAddTaxDeductible(true)} />
          <Pill label={t('deductions.taxDeductibleNo')} selected={!addTaxDeductible} onPress={() => setAddTaxDeductible(false)} />
        </View>

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.dateLabel')}</MutedText>
        </View>
        <Field value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD" />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.amountLabel')}</MutedText>
        </View>
        <Field keyboardType="numeric" value={addAmount} onChangeText={setAddAmount} placeholder="0.00" />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.paymentMethodLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PAYMENT_METHODS.map((p) => (
            <Pill key={p} label={p} selected={addPayment === p} onPress={() => setAddPayment(p)} />
          ))}
        </View>

        {isPersonalPayment(addPayment) && (
          <View
            style={{
              marginTop: spacing.md,
              padding: spacing.sm,
              borderRadius: radii.sm,
              backgroundColor: 'rgba(245,158,11,0.12)',
            }}
          >
            <Text style={{ color: colors.orange, fontSize: typography.size.xs }}>
              {t('deductions.personalPaymentNote')}
            </Text>
          </View>
        )}

        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={addSaving} />
        <SecondaryButton title={t('common.cancel')} onPress={closeAdd} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  totalsBarRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  totalsTile: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card2,
  },
  totalsTileSelected: {
    borderColor: colors.accent,
  },
  totalsTileAmount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  topCategoryRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  topCategoryLabel: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '600' as const,
    flex: 1,
    marginEnd: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    marginStart: spacing.sm,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
  },
  totalLabel: {
    color: colors.muted,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
  },
  totalAmount: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
  },
};
