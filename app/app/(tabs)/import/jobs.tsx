import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useImportJobs, useDismissImportJob, readAgainReaderJob, restartWithReader, IMPORT_JOBS_QUERY_KEY } from '@/src/data/importJobs';
import { silentAttachmentStep, sortImportJobsForDisplay, type ImportJob } from '@/src/import/importJobs';
import { MAX_CONTENT_READS, readerFailureLines, readerJobView, readerReportLines } from '@/src/import/readerJob';
import { useUserCategories } from '@/src/data/userCategories';
import { useCategoryLearningRules } from '@/src/data/categoryLearningRules';
import { useCarrierCodeMaps } from '@/src/data/carrierCodeMaps';
import { formatBuildInfoLine, getBuildInfo } from '@/src/lib/buildInfo';
import { scrubBankDigitsInText } from '@/src/import/bankDigits';
import { useFormatters } from '@/src/i18n/format';
import { Screen, Card, MutedText, SecondaryButton, PrimaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// BACKGROUND IMPORT (owner decision 2026-08-24, item 4): one row per
// imported file, from the SAME useImportJobs() polling hook the persistent
// chip uses (react-query dedupes by query key).
//
// SIMPLE IMPORT FLOW (owner decision 2026-10-31, batch D2 2.1): every row
// is in one of three states — Reading (one line; pauses, interruptions,
// page-cap questions and retries continue automatically and are never
// shown), Ready to check [Check and certify], or Could not read [Upload
// again]. No "Review All" and no batch save. Post-save attachment jobs are
// handled silently by ImportJobsChip and never listed.

function JobRow({ job, onReview, onDismiss }: { job: ImportJob; onReview: (job: ImportJob) => void; onDismiss: (job: ImportJob) => void }) {
  const { t, i18n } = useTranslation();
  const { money } = useFormatters();
  const queryClient = useQueryClient();
  const { data: userCategories } = useUserCategories({ active: true });
  const { data: learningRulesData } = useCategoryLearningRules();
  const { data: carrierCodeMaps } = useCarrierCodeMaps();
  const [busy, setBusy] = useState(false);
  // SETTLEMENT READER (owner decision 2026-11-13): the server decides the
  // state. Reading / Ready to check [Check and certify] (needs_input too) /
  // Could not read with its reasons, [Read again] while reads remain (max
  // 2), [Send report], [Upload again].
  const view = readerJobView(job, new Date().toISOString());
  const state = view.state;
  const [label, color] =
    state === 'ready'
      ? [t('importFlow.statusReady'), colors.green]
      : state === 'failed'
        ? [t('importFlow.statusFailed'), colors.red]
        : [t('importFlow.statusReading'), colors.accent];
  const value = (v: number | string) => (typeof v === 'number' ? money(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v);
  const reasonLines = view.state === 'failed' ? readerFailureLines(view, (k, o) => t(k, o) as string, value) : [];
  async function readAgain() {
    if (view.state !== 'failed' || !view.readAgain) return;
    setBusy(true);
    try {
      if (view.readAgain === 'same_job') await readAgainReaderJob(job.id);
      else
        await restartWithReader(job, {
          locale: i18n.language,
          customCategories: (userCategories ?? []).map((c) => c.name),
          learningRules: (learningRulesData ?? []).map((r) => ({ keyword: r.keyword, category: r.category })),
          carrierCodeMaps: carrierCodeMaps ?? undefined,
        });
      await queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    } catch (err) {
      Alert.alert(t('importFlow.readAgain'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setBusy(false);
    }
  }
  function sendReport() {
    const text = [t('importFlow.couldNotReadTitle'), ...reasonLines, ...readerReportLines(job), `Build: ${formatBuildInfoLine(getBuildInfo())}`].join('\n');
    void Share.share({ message: scrubBankDigitsInText(text) }).catch(() => undefined);
  }

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {job.fileName ?? t('importJobs.untitledFile')}
        </Text>
        <Text style={{ color, fontWeight: '700', fontSize: typography.size.xs }}>{label}</Text>
      </View>

      {view.state === 'reading' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <ActivityIndicator size="small" color={colors.accent} style={{ marginEnd: spacing.xs }} />
          <MutedText style={{ flex: 1 }}>{view.again ? t('importFlow.reader.readingAgain', { n: view.readNo, max: MAX_CONTENT_READS }) : t('importFlow.reading')}</MutedText>
        </View>
      )}

      {state === 'failed' && (
        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('importFlow.couldNotReadTitle')}</MutedText>
          {reasonLines.map((line) => (
            <Text key={line} style={{ color: colors.text, fontSize: typography.size.xs, marginTop: 2 }}>
              {line}
            </Text>
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {state === 'ready' && <PrimaryButton title={t('importFlow.checkAndCertify')} onPress={() => onReview(job)} />}
        {view.state === 'failed' && view.readAgain && <PrimaryButton title={t('importFlow.readAgain')} onPress={() => void readAgain()} disabled={busy} />}
        {view.state === 'failed' &&
          (view.readAgain ? <SecondaryButton title={t('importFlow.uploadAgain')} onPress={() => onDismiss(job)} /> : <PrimaryButton title={t('importFlow.uploadAgain')} onPress={() => onDismiss(job)} />)}
        {state === 'failed' && <SecondaryButton title={t('importFlow.sendReport')} onPress={sendReport} />}
        {state !== 'reading' && <SecondaryButton title={t('common.dismiss')} onPress={() => onDismiss(job)} />}
      </View>
    </Card>
  );
}

export default function ImportJobsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobsQuery = useImportJobs();
  const dismissJob = useDismissImportJob();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(() => {
    // Re-check immediately on focus rather than waiting for the next
    // polling tick.
    queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY });
  });

  async function onRefresh() {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    } finally {
      setRefreshing(false);
    }
  }

  function handleReview(job: ImportJob) {
    router.push({ pathname: '/(tabs)/import', params: { reviewJobId: job.id } } as unknown as Href);
  }

  // Nothing of a job is saved until "Certify and add", so dismissing (or
  // "Upload again" on a failed one) only removes the reading.
  function handleDismiss(job: ImportJob) {
    if (readerJobView(job, new Date().toISOString()).state === 'failed') {
      dismissJob.mutate(job.id);
      router.push('/(tabs)/import' as Href);
      return;
    }
    Alert.alert(t('importJobs.dismissConfirmTitle'), t('importJobs.dismissConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.dismiss'), style: 'destructive', onPress: () => dismissJob.mutate(job.id) },
    ]);
  }

  const jobs = sortImportJobsForDisplay((jobsQuery.data ?? []).filter((j) => j.reader || silentAttachmentStep(j) == null));

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {jobsQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : jobs.length === 0 ? (
          <Card>
            <MutedText>{t('importJobs.empty')}</MutedText>
          </Card>
        ) : (
          jobs.map((job) => <JobRow key={job.id} job={job} onReview={handleReview} onDismiss={handleDismiss} />)
        )}
      </ScrollView>
    </Screen>
  );
}
