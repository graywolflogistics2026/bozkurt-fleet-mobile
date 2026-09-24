import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useDocuments } from '@/src/data/documents';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions, useUpdateDeduction } from '@/src/data/deductions';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useBankStatements } from '@/src/data/bankStatements';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useHouseholdIncome } from '@/src/data/householdIncome';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useLoads } from '@/src/data/loads';
import { useReimbursements } from '@/src/data/reimbursements';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useMarkDocumentReviewed } from '@/src/data/needsReviewMutations';
import {
  filterDocuments,
  distinctDocTypes,
  findLinkedRecords,
  isImageFilename,
  type LinkedRecordRef,
} from '@/src/data/documentsFilter';
import { getSignedDocumentUrl, shareDocumentFile } from '@/src/data/documentViewer';
import { findDocumentsNeedingTitle, linkedTitleInputsFor, resolveDocumentTitle, suggestDocumentTitle } from '@/src/data/documentTitle';
import { usePrimeDriverExpenses } from '@/src/data/primeDriverExpenses';
import { useSetDocumentTitle } from '@/src/data/documentTitleMutations';
import { useDocumentTitleContext } from '@/src/data/useDocumentTitleContext';
import { MonthGroupedList } from '@/src/components/monthGroups/MonthGroupedList';
import { needsReviewRowStyle, NeedsReviewChip, MarkReviewedButton } from '@/src/components/NeedsReviewBadge';
import { DestinationSummary } from '@/src/components/DestinationSummary';
import { isDocumentNeedsReview } from '@/src/import/needsReview';
import { normalizePaymentMethod, type PaymentMethod } from '@/src/import/paymentMethods';
import { findRowToAutoOpen } from '@/src/navigation/autoOpenParam';
import { buildLinkedRecordHref } from '@/src/navigation/linkedRecordRoute';
import { DOC_TYPE_ICON, useDocTypeMeta } from '@/src/import/docTypes';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, TappableCard, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { DocType } from '@/src/import/types';
import type { DocumentRow } from '@/src/types/db';

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

export default function DocumentsArchive() {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const router = useRouter();
  const { openId } = useLocalSearchParams<{ openId?: string }>();
  const autoOpenedRef = useRef(false);
  const docTypeMeta = useDocTypeMeta();

  const queryClient = useQueryClient();
  const documentsQuery = useDocuments();
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const maintenanceQuery = useMaintenanceRecords();
  const bankStatementsQuery = useBankStatements();
  const complianceItemsQuery = useComplianceItems();
  const householdIncomeQuery = useHouseholdIncome();
  const fuelQuery = useFuelPurchases();
  const loadsQuery = useLoads();
  const reimbursementsQuery = useReimbursements();
  const primeDriverExpensesQuery = usePrimeDriverExpenses();
  const markDocumentReviewed = useMarkDocumentReviewed();
  const updateDeduction = useUpdateDeduction();
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  const [search, setSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // BETA FEEDBACK ROUND 2: "Needs review only" filter toggle.
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [selected, setSelected] = useState<DocumentRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  // DOCUMENT TITLES (owner decision 2026-09-23, docs/PENDING_SQL.md §76).
  const titleContext = useDocumentTitleContext();
  const setDocumentTitle = useSetDocumentTitle();
  // Inline title editing in the detail view: the title IS a text field.
  const [titleDraft, setTitleDraft] = useState('');
  const [reviewingTitles, setReviewingTitles] = useState(false);
  const [ownTitles, setOwnTitles] = useState<Record<string, string>>({});
  const [savingTitleFor, setSavingTitleFor] = useState<string | null>(null);

  const allDocs = documentsQuery.data ?? [];
  // "Needs a title" — only generically titled documents, newest first.
  const needsTitle = useMemo(() => findDocumentsNeedingTitle(allDocs), [allDocs]);
  const titleSources = useMemo(
    () => ({
      settlements: settlementsQuery.data,
      deductions: deductionsQuery.data,
      maintenanceRecords: maintenanceQuery.data,
      complianceItems: complianceItemsQuery.data,
      primeDriverExpenses: primeDriverExpensesQuery.data,
    }),
    [settlementsQuery.data, deductionsQuery.data, maintenanceQuery.data, complianceItemsQuery.data, primeDriverExpensesQuery.data]
  );
  // THE title every list row AND the detail view shows (saved title, then
  // linked record, then extraction, then vendor, then the type label).
  const titles = useMemo(
    () =>
      new Map(
        allDocs.map((doc) => [
          doc.id,
          resolveDocumentTitle(doc, linkedTitleInputsFor(doc.id, titleSources), titleContext, docTypeMeta((doc.doc_type as DocType) ?? 'other').label),
        ])
      ),
    [allDocs, titleSources, titleContext, docTypeMeta]
  );
  const titleSuggestions = useMemo(
    () => new Map(needsTitle.map((doc) => [doc.id, suggestDocumentTitle(doc, linkedTitleInputsFor(doc.id, titleSources), titleContext)])),
    [needsTitle, titleSources, titleContext]
  );

  async function saveTitle(documentId: string, title: string, source: 'ai' | 'record' | 'user') {
    setSavingTitleFor(documentId);
    try {
      await setDocumentTitle.mutateAsync({ documentId, title, source });
      await invalidateFinancialData(queryClient, { entities: ['documents'] });
      return true;
    } catch (err) {
      Alert.alert(t('documentsArchive.titles.saveFailed'), err instanceof Error ? err.message : t('common.tryAgain'));
      return false;
    } finally {
      setSavingTitleFor(null);
    }
  }

  // Commit an inline title edit (on "done" or when the field loses focus).
  // An empty field or an unchanged title just reverts — nothing is saved.
  async function commitTitleEdit(doc: DocumentRow, shownTitle: string) {
    const next = titleDraft.trim();
    if (!next || next === shownTitle) {
      setTitleDraft(shownTitle);
      return;
    }
    if (await saveTitle(doc.id, next, 'user')) {
      setSelected((current) => (current && current.id === doc.id ? { ...current, title: next, title_source: 'user' } : current));
    }
  }

  // Seed the editable title whenever a document is opened.
  useEffect(() => {
    if (selected) setTitleDraft(titles.get(selected.id) ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  const types = useMemo(() => distinctDocTypes(allDocs), [allDocs]);
  const rows = useMemo(
    () =>
      filterDocuments(allDocs, {
        search,
        docType: docTypeFilter,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        needsReviewOnly,
      }),
    [allDocs, search, docTypeFilter, dateFrom, dateTo, needsReviewOnly]
  );

  // "View original document" from a settlement/deduction/maintenance detail
  // (owner decision 2026-07-30) jumps here with ?openId=<documentId> —
  // auto-opens that document's viewer exactly once.
  useEffect(() => {
    const match = findRowToAutoOpen(allDocs, openId, autoOpenedRef.current);
    if (match) {
      autoOpenedRef.current = true;
      setSelected(match);
    }
  }, [allDocs, openId]);

  const linkedRecords = useMemo(() => {
    if (!selected) return [];
    return findLinkedRecords(selected.id, {
      settlements: settlementsQuery.data,
      deductions: deductionsQuery.data,
      maintenanceRecords: maintenanceQuery.data,
      bankStatements: bankStatementsQuery.data,
      complianceItems: complianceItemsQuery.data,
      householdIncome: householdIncomeQuery.data,
      fuelPurchases: fuelQuery.data,
      loads: loadsQuery.data,
      reimbursements: reimbursementsQuery.data,
    });
  }, [
    selected,
    settlementsQuery.data,
    deductionsQuery.data,
    maintenanceQuery.data,
    bankStatementsQuery.data,
    complianceItemsQuery.data,
    householdIncomeQuery.data,
    fuelQuery.data,
    loadsQuery.data,
    reimbursementsQuery.data,
  ]);

  // PAYMENT + DESTINATION SUMMARY (item 2) — a payment method is only shown
  // as editable when the document maps to EXACTLY ONE deduction (the common
  // receipt case); a settlement (no payment_method column exists on that
  // table at all) or a document linked to several deductions has no single
  // coherent value to show/edit, so the row is simply omitted rather than
  // guessing one.
  const singleLinkedDeduction = useMemo(() => {
    const deductionRefs = linkedRecords.filter((r) => r.kind === 'deduction');
    if (deductionRefs.length !== 1) return null;
    return (deductionsQuery.data ?? []).find((d) => d.id === deductionRefs[0].id) ?? null;
  }, [linkedRecords, deductionsQuery.data]);

  useEffect(() => {
    if (!selected?.storage_path) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    setUrlLoading(true);
    setUrlError(null);
    getSignedDocumentUrl(selected.storage_path)
      .then((url) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setUrlError(err instanceof Error ? err.message : t('documentsArchive.viewFailed'));
      })
      .finally(() => {
        if (!cancelled) setUrlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, t]);

  function closeViewer() {
    setSelected(null);
    setSignedUrl(null);
    setUrlError(null);
  }

  async function handleOpen() {
    if (!signedUrl) return;
    try {
      await WebBrowser.openBrowserAsync(signedUrl);
    } catch (err) {
      Alert.alert(t('documentsArchive.viewFailed'), err instanceof Error ? err.message : t('common.tryAgain'));
    }
  }

  async function handleShare() {
    if (!selected?.storage_path) return;
    setSharing(true);
    try {
      await shareDocumentFile(selected.storage_path, selected.filename ?? 'document');
    } catch (err) {
      Alert.alert(t('documentsArchive.shareFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSharing(false);
    }
  }

  function handleOpenLinkedRecord(ref: LinkedRecordRef) {
    closeViewer();
    router.push(buildLinkedRecordHref(ref));
  }

  // NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24, device
  // testing round): the one control that marks a document (and, by
  // extension per needsReview.ts, any settlement linked to it) reviewed.
  async function handleMarkReviewed() {
    if (!selected) return;
    setMarkingReviewed(true);
    try {
      await markDocumentReviewed.mutateAsync(selected.id);
      await invalidateFinancialData(queryClient, { entities: ['documents'] });
    } catch (err) {
      Alert.alert(t('documentsArchive.viewFailed'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setMarkingReviewed(false);
    }
  }

  // PAYMENT + DESTINATION SUMMARY (item 2) — editing the payment method
  // here flows through the SAME useUpdateDeduction() mutation the
  // Deductions screen itself uses, so every dependent screen (Capital
  // Account's owner-paid detection, category learning's carrier scoping,
  // etc.) refreshes identically regardless of which screen made the edit.
  async function handleChangePaymentMethod(method: PaymentMethod) {
    if (!singleLinkedDeduction) return;
    setSavingPayment(true);
    try {
      await updateDeduction.mutateAsync({ id: singleLinkedDeduction.id, values: { payment_method: method } });
      await invalidateFinancialData(queryClient, { entities: ['deductions'] });
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSavingPayment(false);
    }
  }

  async function handleChangeDeductionCategory(deductionId: string, category: string) {
    try {
      await updateDeduction.mutateAsync({ id: deductionId, values: { category } });
      await invalidateFinancialData(queryClient, { entities: ['deductions'] });
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    }
  }

  const image = selected?.storage_path && isImageFilename(selected.filename);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('documentsArchive.title')}</ScreenTitle>
        {/* SELF-TEST AUDIT (owner decision, MULTI-TRUCK MODEL) — the
            `documents` table has no truck_id column at all (it's a raw
            upload/audit-trail archive — some documents never even
            produce a truck-attributable record). Rather than leave this
            silently unscoped and unexplained, it's treated as the same
            fleet-wide category every other whole-account archive/report
            screen already is. */}
        <FleetScopeLabel variant="fleetOnly" />
        <MutedText style={{ marginBottom: spacing.sm }}>{t('documentsArchive.subtitle')}</MutedText>

        {/* NEEDS A TITLE (owner decision 2026-09-23) — a manual,
            user-started review pass; nothing is renamed in the background. */}
        {needsTitle.length > 0 && (
          <Card style={{ marginBottom: spacing.sm, borderColor: colors.accent, borderWidth: 2 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              🏷️ {t('documentsArchive.titles.bannerTitle', { count: needsTitle.length })}
            </Text>
            <MutedText style={{ marginTop: spacing.xs }}>{t('documentsArchive.titles.bannerBody')}</MutedText>
            <PrimaryButton title={t('documentsArchive.titles.reviewButton')} onPress={() => setReviewingTitles(true)} />
          </Card>
        )}

        <Field
          value={search}
          onChangeText={setSearch}
          placeholder={t('documentsArchive.searchPlaceholder')}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          <Pill label={t('documentsArchive.allTypes')} selected={!docTypeFilter} onPress={() => setDocTypeFilter(null)} />
          {types.map((type) => (
            <Pill
              key={type}
              label={docTypeMeta(type as DocType).label}
              selected={docTypeFilter === type}
              onPress={() => setDocTypeFilter(type)}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <MutedText>{t('documentsArchive.dateFromLabel')}</MutedText>
            <Field value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <MutedText>{t('documentsArchive.dateToLabel')}</MutedText>
            <Field value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" />
          </View>
        </View>

        <View style={{ flexDirection: 'row', marginTop: spacing.sm, marginBottom: spacing.sm }}>
          <Pill
            label={t('needsReview.filterOnly')}
            selected={needsReviewOnly}
            onPress={() => setNeedsReviewOnly((v) => !v)}
          />
        </View>

        <MonthGroupedList
          screenKey="documents"
          rows={rows}
          getDate={(doc) => doc.doc_date ?? doc.imported_at}
          getAmount={(doc) => doc.amount ?? 0}
          loading={documentsQuery.isLoading}
          loadingLabel={t('common.loading')}
          emptyLabel={allDocs.length === 0 ? t('documentsArchive.emptyState') : t('documentsArchive.noMatches')}
          renderRows={(monthRows) =>
            monthRows.map((doc) => {
              const meta = docTypeMeta((doc.doc_type as DocType) ?? 'other');
              const title = titles.get(doc.id) ?? meta.label;
              const needsReview = isDocumentNeedsReview(doc);
              return (
                <TappableCard key={doc.id} onPress={() => setSelected(doc)} style={needsReviewRowStyle(needsReview)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 24, marginEnd: spacing.sm }}>{DOC_TYPE_ICON[(doc.doc_type as DocType) ?? 'other'] ?? '📄'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
                      <MutedText>
                        {title !== meta.label ? `${meta.label} · ` : ''}
                        {doc.doc_date ? date(doc.doc_date) : date(doc.imported_at)}
                        {doc.filename ? ` · ${doc.filename}` : ''}
                      </MutedText>
                      {needsReview && <NeedsReviewChip />}
                    </View>
                    {doc.amount != null && <Text style={{ color: colors.text, fontWeight: '700' }}>{money(doc.amount)}</Text>}
                  </View>
                </TappableCard>
              );
            })
          }
        />
      </ScrollView>

      <ModalSheet visible={!!selected} onClose={closeViewer}>
        {selected && (() => {
          const selectedMeta = docTypeMeta((selected.doc_type as DocType) ?? 'other');
          const selectedTitle = titles.get(selected.id) ?? selectedMeta.label;
          return (
            <>
              {/* INLINE TITLE (owner decision 2026-09-23) — the title at the
                  top IS the text field: tap it and type, no rename menu.
                  Saves as the user's own title when you tap Done or leave the
                  field; empty or unchanged just reverts. */}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                  value={titleDraft}
                  onChangeText={setTitleDraft}
                  onBlur={() => commitTitleEdit(selected, selectedTitle)}
                  placeholder={t('documentsArchive.titles.placeholder')}
                  placeholderTextColor={colors.muted}
                  selectTextOnFocus
                  returnKeyType="done"
                  blurOnSubmit
                  multiline={false}
                  accessibilityLabel={t('documentsArchive.titles.rename')}
                  style={{ flex: 1, color: colors.text, fontSize: typography.size.lg, fontWeight: '700', paddingVertical: spacing.xs }}
                />
                <Text style={{ color: colors.accent, fontSize: typography.size.md, marginStart: spacing.xs }}>✎</Text>
              </View>
              <MutedText style={{ color: colors.accent, fontSize: typography.size.xs, marginBottom: spacing.sm }}>
                {savingTitleFor === selected.id ? t('common.loading') : t('documentsArchive.titles.tapToRename')}
              </MutedText>
              {selectedTitle !== selectedMeta.label && <MutedText>{selectedMeta.label}</MutedText>}
              {isDocumentNeedsReview(selected) && (
                <>
                  <NeedsReviewChip />
                  <MarkReviewedButton onPress={handleMarkReviewed} isPending={markingReviewed} />
                </>
              )}
              <MutedText>{selected.doc_date ? date(selected.doc_date) : date(selected.imported_at)}</MutedText>
              {selected.filename && <MutedText>{selected.filename}</MutedText>}
              {selected.amount != null && (
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg, marginTop: spacing.xs }}>
                  {money(selected.amount)}
                </Text>
              )}

              {!selected.storage_path ? (
                <MutedText style={{ marginTop: spacing.md }}>{t('documentsArchive.noFile')}</MutedText>
              ) : urlLoading ? (
                <MutedText style={{ marginTop: spacing.md }}>{t('common.loading')}</MutedText>
              ) : urlError ? (
                <MutedText style={{ marginTop: spacing.md, color: colors.red }}>{urlError}</MutedText>
              ) : (
                signedUrl && (
                  <View style={{ marginTop: spacing.md }}>
                    {image ? (
                      <Image
                        source={{ uri: signedUrl }}
                        style={{ width: '100%', height: 320, borderRadius: radii.sm, backgroundColor: colors.card2 }}
                        resizeMode="contain"
                      />
                    ) : (
                      <PrimaryButton title={t('documentsArchive.openDocument')} onPress={handleOpen} />
                    )}
                    <SecondaryButton title={t('documentsArchive.shareDownload')} onPress={handleShare} />
                  </View>
                )
              )}

              {sharing && <MutedText style={{ marginTop: spacing.sm }}>{t('documentsArchive.preparingShare')}</MutedText>}

              <DestinationSummary
                refs={linkedRecords}
                onOpenRef={handleOpenLinkedRecord}
                payment={
                  singleLinkedDeduction
                    ? {
                        method: normalizePaymentMethod(singleLinkedDeduction.payment_method),
                        onChangeMethod: handleChangePaymentMethod,
                        saving: savingPayment,
                      }
                    : null
                }
                onChangeDeductionCategory={handleChangeDeductionCategory}
              />

              <SecondaryButton title={t('common.cancel')} onPress={closeViewer} />
            </>
          );
        })()}
      </ModalSheet>

      {/* NEEDS A TITLE — review queue. Accept the suggestion with one tap,
          or type your own. A document leaves the list once it has a title. */}
      <ModalSheet visible={reviewingTitles} onClose={() => setReviewingTitles(false)}>
        <SheetTitle>{t('documentsArchive.titles.reviewTitle')}</SheetTitle>
        {needsTitle.length === 0 ? (
          <MutedText>{t('documentsArchive.titles.allDone')}</MutedText>
        ) : (
          needsTitle.map((doc) => {
            const meta = docTypeMeta((doc.doc_type as DocType) ?? 'other');
            const suggestion = titleSuggestions.get(doc.id) ?? null;
            const own = ownTitles[doc.id] ?? '';
            const saving = savingTitleFor === doc.id;
            return (
              <View key={doc.id} style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  {DOC_TYPE_ICON[(doc.doc_type as DocType) ?? 'other'] ?? '📄'} {meta.label}
                </Text>
                <MutedText>
                  {doc.doc_date ? date(doc.doc_date) : date(doc.imported_at)}
                  {doc.amount != null ? ` · ${money(doc.amount)}` : ''}
                  {doc.filename ? ` · ${doc.filename}` : ''}
                </MutedText>
                {suggestion ? (
                  <PrimaryButton
                    title={t('documentsArchive.titles.useSuggestion', { title: suggestion.title })}
                    onPress={() => saveTitle(doc.id, suggestion.title, suggestion.source)}
                    loading={saving}
                  />
                ) : (
                  <MutedText style={{ marginTop: spacing.xs }}>{t('documentsArchive.titles.noSuggestion')}</MutedText>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      value={own}
                      onChangeText={(text) => setOwnTitles((prev) => ({ ...prev, [doc.id]: text }))}
                      placeholder={t('documentsArchive.titles.placeholder')}
                      style={{ marginBottom: 0 }}
                    />
                  </View>
                  <Pressable
                    onPress={() => own.trim() && !saving && saveTitle(doc.id, own, 'user')}
                    hitSlop={8}
                    style={{ marginStart: spacing.sm }}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: own.trim() ? colors.accent : colors.muted, fontWeight: '700' }}>{t('common.save')}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
        <SecondaryButton title={t('common.close')} onPress={() => setReviewingTitles(false)} />
      </ModalSheet>
    </Screen>
  );
}
