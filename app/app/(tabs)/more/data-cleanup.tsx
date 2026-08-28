import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import {
  useOrphanSummary,
  useDeleteOrphanTolls,
  useDeleteOrphanMaintenanceRecords,
  useDeleteOrphanDocuments,
  useDeleteDuplicateLoans,
  type OrphanToll,
  type OrphanMaintenanceRecord,
  type OrphanDocument,
  type DuplicateLoanRow,
} from '@/src/data/orphanCleanup';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, PrimaryButton } from '@/src/components/ui';
import { colors, spacing } from '@/src/theme';

// ORPHAN CLEANUP TOOL (owner decision, docs/PENDING_SQL.md §70, item 7) —
// "list every orphaned record and file whose parent settlement no longer
// exists, with counts and amounts, and let me remove them after review."
// One-time, review-then-remove — see orphanCleanup.ts's own header comment
// for why this only ever finds HISTORICAL (pre-fix) leftovers, and why
// settlement-sourced loans are shown informationally but never offered for
// deletion here.

function sum(values: (number | null)[]): number {
  return values.reduce((total: number, v) => total + (v ?? 0), 0);
}

export default function DataCleanup() {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const summaryQuery = useOrphanSummary();
  const deleteTolls = useDeleteOrphanTolls();
  const deleteMaintenance = useDeleteOrphanMaintenanceRecords();
  const deleteDocuments = useDeleteOrphanDocuments();
  const deleteDuplicateLoans = useDeleteDuplicateLoans();

  const [selectedTolls, setSelectedTolls] = useState<Set<string>>(new Set());
  const [selectedMaintenance, setSelectedMaintenance] = useState<Set<string>>(new Set());
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [selectedLoans, setSelectedLoans] = useState<Set<string>>(new Set());

  const summary = summaryQuery.data;
  const tollsTotal = useMemo(() => sum((summary?.tolls ?? []).map((x) => x.amount)), [summary]);
  const maintenanceTotal = useMemo(() => sum((summary?.maintenanceRecords ?? []).map((x) => x.cost)), [summary]);

  const isEmpty =
    !!summary &&
    summary.tolls.length === 0 &&
    summary.maintenanceRecords.length === 0 &&
    summary.documents.length === 0 &&
    summary.settlementSourcedLoans.length === 0 &&
    summary.duplicateLoanGroups.length === 0;

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  function selectAll(ids: string[], setSet: (s: Set<string>) => void) {
    setSet(new Set(ids));
  }

  function confirmDeleteTolls(ids: string[]) {
    if (ids.length === 0) return;
    const total = sum((summary?.tolls ?? []).filter((x) => ids.includes(x.id)).map((x) => x.amount));
    Alert.alert(
      t('dataCleanup.confirmTitle', { count: ids.length }),
      t('dataCleanup.confirmBody', { count: ids.length, amount: money(total) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dataCleanup.removeButton'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTolls.mutateAsync(ids);
              setSelectedTolls(new Set());
            } catch (err) {
              Alert.alert(t('common.error'), err instanceof Error ? err.message : t('deductions.genericRetry'));
            }
          },
        },
      ]
    );
  }

  function confirmDeleteMaintenance(ids: string[]) {
    if (ids.length === 0) return;
    const total = sum((summary?.maintenanceRecords ?? []).filter((x) => ids.includes(x.id)).map((x) => x.cost));
    Alert.alert(
      t('dataCleanup.confirmTitle', { count: ids.length }),
      t('dataCleanup.confirmBody', { count: ids.length, amount: money(total) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dataCleanup.removeButton'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMaintenance.mutateAsync(ids);
              setSelectedMaintenance(new Set());
            } catch (err) {
              Alert.alert(t('common.error'), err instanceof Error ? err.message : t('deductions.genericRetry'));
            }
          },
        },
      ]
    );
  }

  function confirmDeleteDocuments(ids: string[]) {
    if (ids.length === 0) return;
    Alert.alert(
      t('dataCleanup.confirmTitle', { count: ids.length }),
      t('dataCleanup.confirmDocumentsBody', { count: ids.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dataCleanup.removeButton'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDocuments.mutateAsync(ids);
              setSelectedDocuments(new Set());
            } catch (err) {
              Alert.alert(t('common.error'), err instanceof Error ? err.message : t('deductions.genericRetry'));
            }
          },
        },
      ]
    );
  }

  function Row({
    checked,
    onToggle,
    title,
    subtitle,
    amount,
  }: {
    checked: boolean;
    onToggle: () => void;
    title: string;
    subtitle: string;
    amount: string | null;
  }) {
    return (
      <Pressable
        onPress={onToggle}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text style={{ fontSize: 18, marginEnd: spacing.sm }}>{checked ? '☑️' : '⬜'}</Text>
        <View style={{ flex: 1, marginEnd: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
            {title}
          </Text>
          <MutedText numberOfLines={1}>{subtitle}</MutedText>
        </View>
        {amount != null && <Text style={{ color: colors.text, fontWeight: '700' }}>{amount}</Text>}
      </Pressable>
    );
  }

  function tollRowSubtitle(x: OrphanToll) {
    return [x.plaza, x.toll_date ? date(x.toll_date) : null].filter(Boolean).join(' · ') || t('dataCleanup.noDetails');
  }

  function maintenanceRowSubtitle(x: OrphanMaintenanceRecord) {
    return [x.description, x.service_date ? date(x.service_date) : null].filter(Boolean).join(' · ') || t('dataCleanup.noDetails');
  }

  function documentRowSubtitle(x: OrphanDocument) {
    return [x.doc_type, date(x.imported_at)].filter(Boolean).join(' · ');
  }

  function loanRowSubtitle(x: DuplicateLoanRow) {
    return [x.balance != null ? money(x.balance) : '—', date(x.created_at)].filter(Boolean).join(' · ');
  }

  function confirmDeleteDuplicateLoans(ids: string[]) {
    if (ids.length === 0) return;
    Alert.alert(
      t('dataCleanup.confirmTitle', { count: ids.length }),
      t('dataCleanup.confirmDuplicateLoansBody', { count: ids.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('dataCleanup.removeButton'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDuplicateLoans.mutateAsync(ids);
              setSelectedLoans(new Set());
            } catch (err) {
              Alert.alert(t('common.error'), err instanceof Error ? err.message : t('deductions.genericRetry'));
            }
          },
        },
      ]
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('dataCleanup.title')}</ScreenTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>{t('dataCleanup.subtitle')}</MutedText>

        {summaryQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : isEmpty ? (
          <Card>
            <MutedText>{t('dataCleanup.allClean')}</MutedText>
          </Card>
        ) : (
          <>
            {(summary?.tolls.length ?? 0) > 0 && (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {t('dataCleanup.tollsTitle', { count: summary!.tolls.length, amount: money(tollsTotal) })}
                  </Text>
                  <Pressable onPress={() => selectAll(summary!.tolls.map((x) => x.id), setSelectedTolls)}>
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('dataCleanup.selectAll')}</Text>
                  </Pressable>
                </View>
                {summary!.tolls.map((x) => (
                  <Row
                    key={x.id}
                    checked={selectedTolls.has(x.id)}
                    onToggle={() => toggle(selectedTolls, setSelectedTolls, x.id)}
                    title={t('dataCleanup.orphanTollRow')}
                    subtitle={tollRowSubtitle(x)}
                    amount={x.amount != null ? money(x.amount) : null}
                  />
                ))}
                <View style={{ marginTop: spacing.sm }}>
                  <PrimaryButton
                    title={t('dataCleanup.removeSelected', { count: selectedTolls.size })}
                    onPress={() => confirmDeleteTolls([...selectedTolls])}
                    disabled={selectedTolls.size === 0}
                    loading={deleteTolls.isPending}
                  />
                </View>
              </Card>
            )}

            {(summary?.maintenanceRecords.length ?? 0) > 0 && (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {t('dataCleanup.maintenanceTitle', { count: summary!.maintenanceRecords.length, amount: money(maintenanceTotal) })}
                  </Text>
                  <Pressable onPress={() => selectAll(summary!.maintenanceRecords.map((x) => x.id), setSelectedMaintenance)}>
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('dataCleanup.selectAll')}</Text>
                  </Pressable>
                </View>
                {summary!.maintenanceRecords.map((x) => (
                  <Row
                    key={x.id}
                    checked={selectedMaintenance.has(x.id)}
                    onToggle={() => toggle(selectedMaintenance, setSelectedMaintenance, x.id)}
                    title={t('dataCleanup.orphanMaintenanceRow')}
                    subtitle={maintenanceRowSubtitle(x)}
                    amount={x.cost != null ? money(x.cost) : null}
                  />
                ))}
                <View style={{ marginTop: spacing.sm }}>
                  <PrimaryButton
                    title={t('dataCleanup.removeSelected', { count: selectedMaintenance.size })}
                    onPress={() => confirmDeleteMaintenance([...selectedMaintenance])}
                    disabled={selectedMaintenance.size === 0}
                    loading={deleteMaintenance.isPending}
                  />
                </View>
              </Card>
            )}

            {(summary?.documents.length ?? 0) > 0 && (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{t('dataCleanup.documentsTitle', { count: summary!.documents.length })}</Text>
                  <Pressable onPress={() => selectAll(summary!.documents.map((x) => x.id), setSelectedDocuments)}>
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('dataCleanup.selectAll')}</Text>
                  </Pressable>
                </View>
                <MutedText style={{ marginBottom: spacing.xs }}>{t('dataCleanup.documentsNote')}</MutedText>
                {summary!.documents.map((x) => (
                  <Row
                    key={x.id}
                    checked={selectedDocuments.has(x.id)}
                    onToggle={() => toggle(selectedDocuments, setSelectedDocuments, x.id)}
                    title={x.filename ?? t('dataCleanup.orphanDocumentRow')}
                    subtitle={documentRowSubtitle(x)}
                    amount={null}
                  />
                ))}
                <View style={{ marginTop: spacing.sm }}>
                  <PrimaryButton
                    title={t('dataCleanup.removeSelected', { count: selectedDocuments.size })}
                    onPress={() => confirmDeleteDocuments([...selectedDocuments])}
                    disabled={selectedDocuments.size === 0}
                    loading={deleteDocuments.isPending}
                  />
                </View>
              </Card>
            )}

            {(summary?.duplicateLoanGroups.length ?? 0) > 0 && (
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('dataCleanup.duplicateLoansTitle', { count: summary!.duplicateLoanGroups.length })}
                </Text>
                <MutedText style={{ marginBottom: spacing.sm }}>{t('dataCleanup.duplicateLoansNote')}</MutedText>
                {summary!.duplicateLoanGroups.map((group) => (
                  <View key={group.key} style={{ marginBottom: spacing.sm }}>
                    <MutedText style={{ marginBottom: spacing.xs, textTransform: 'capitalize' }}>{group.key}</MutedText>
                    {group.loans.map((x, i) => (
                      <View key={x.id}>
                        {i === 0 && (
                          <MutedText style={{ color: colors.green, marginBottom: 2 }}>{t('dataCleanup.duplicateLoansRecommendedKeep')}</MutedText>
                        )}
                        <Row
                          checked={selectedLoans.has(x.id)}
                          onToggle={() => toggle(selectedLoans, setSelectedLoans, x.id)}
                          title={x.name ?? t('dataCleanup.orphanDocumentRow')}
                          subtitle={loanRowSubtitle(x)}
                          amount={null}
                        />
                      </View>
                    ))}
                  </View>
                ))}
                <View style={{ marginTop: spacing.sm }}>
                  <PrimaryButton
                    title={t('dataCleanup.removeSelected', { count: selectedLoans.size })}
                    onPress={() => confirmDeleteDuplicateLoans([...selectedLoans])}
                    disabled={selectedLoans.size === 0}
                    loading={deleteDuplicateLoans.isPending}
                  />
                </View>
                <Pressable onPress={() => router.push('/(tabs)/more/loans')} style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('dataCleanup.viewInLoanCenter')}</Text>
                </Pressable>
              </Card>
            )}

            {(summary?.settlementSourcedLoans.length ?? 0) > 0 && (
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('dataCleanup.loansTitle', { count: summary!.settlementSourcedLoans.length })}
                </Text>
                <MutedText style={{ marginBottom: spacing.xs }}>{t('dataCleanup.loansNote')}</MutedText>
                {summary!.settlementSourcedLoans.map((x) => (
                  <View key={x.id} style={{ paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{x.name ?? t('dataCleanup.orphanDocumentRow')}</Text>
                    <MutedText>
                      {x.balance != null ? money(x.balance) : '—'} · {x.settlement_id ? t('loans.sourceSettlementLinked') : t('loans.sourceSettlementUnlinked')}
                    </MutedText>
                  </View>
                ))}
                <Pressable onPress={() => router.push('/(tabs)/more/loans')} style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('dataCleanup.viewInLoanCenter')}</Text>
                </Pressable>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
