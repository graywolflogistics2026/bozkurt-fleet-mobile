import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useImportJobs, useRetryImportJob, useDismissImportJob, fetchImportJobResult, IMPORT_JOBS_QUERY_KEY } from '@/src/data/importJobs';
import { sortImportJobsForDisplay, sortJobIdsByDocumentDate, jobProgressFraction, isStrandedJob, type ImportJob } from '@/src/import/importJobs';
import { getPrimaryExtractionDate } from '@/src/import/dateGuard';
import { useFormatters } from '@/src/i18n/format';
import { Screen, Card, MutedText, SecondaryButton, PrimaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// BACKGROUND IMPORT (owner decision 2026-08-24, item 4 "multiple imports
// queue up... show them as a small list with per-item status and retry")
// — reads the SAME useImportJobs() polling hook the persistent chip does
// (react-query dedupes by query key, so mounting both never doubles the
// real network polling).
function statusColor(status: ImportJob['status']): string {
  if (status === 'ready') return colors.green;
  if (status === 'failed') return colors.red;
  // BATCH BACK-PRESSURE (owner decision 2026-08-24) — amber, same as the
  // needs-review badge, reads as "please note this, not an error" rather
  // than red's existing "expense/cost/negative" meaning app-wide.
  if (status === 'waiting_to_retry') return colors.orange;
  return colors.accent;
}

function JobRow({
  job,
  onReview,
  onRetry,
  onDismiss,
  retrying,
}: {
  job: ImportJob;
  onReview: (job: ImportJob) => void;
  onRetry: (job: ImportJob) => void;
  onDismiss: (job: ImportJob) => void;
  retrying: boolean;
}) {
  const { t } = useTranslation();
  const fraction = jobProgressFraction(job);
  // UNAWAITED handleJobStart + EdgeRuntime.waitUntil WITHOUT A CAPABILITY
  // CHECK (P1 fix, FULL SYSTEM AUDIT) — "surface stranded jobs to the user
  // with a Retry." A stranded job's own `status` is still technically
  // active (queued/processing/waiting_to_retry — nothing ever wrote
  // 'failed' to it), so it needs its OWN visual treatment distinct from
  // the ordinary in-progress spinner below, not just a reuse of the
  // `failed` branch's copy.
  const stranded = isStrandedJob(job, new Date().toISOString());

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {job.fileName ?? t('importJobs.untitledFile')}
        </Text>
        <Text style={{ color: stranded ? colors.red : statusColor(job.status), fontWeight: '700', fontSize: typography.size.xs }}>
          {stranded ? t('importJobs.status.stranded') : t(`importJobs.status.${job.status}`)}
        </Text>
      </View>

      {stranded && (
        <MutedText style={{ color: colors.red, marginBottom: spacing.xs }} numberOfLines={2}>
          {t('importJobs.strandedNote')}
        </MutedText>
      )}

      {!stranded && (job.status === 'queued' || job.status === 'processing') && (
        <View style={{ marginBottom: spacing.xs }}>
          {fraction != null ? (
            <>
              <View style={{ height: 6, borderRadius: radii.sm, backgroundColor: colors.card2, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${Math.round(fraction * 100)}%`, backgroundColor: colors.accent }} />
              </View>
              <MutedText style={{ marginTop: 2 }}>{t('importJobs.pageProgress', { through: job.pagesDone, total: job.pagesTotal })}</MutedText>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.accent} style={{ marginEnd: spacing.xs }} />
              <MutedText>{t('importJobs.starting')}</MutedText>
            </View>
          )}
        </View>
      )}

      {!stranded && job.status === 'waiting_to_retry' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <ActivityIndicator size="small" color={colors.orange} style={{ marginEnd: spacing.xs }} />
          <MutedText style={{ color: colors.orange, flex: 1 }} numberOfLines={2}>
            {t('importJobs.waitingToRetryNote')}
          </MutedText>
        </View>
      )}

      {job.status === 'failed' && (
        <MutedText style={{ color: colors.red, marginBottom: spacing.xs }} numberOfLines={2}>
          {job.errorMessage ?? t('importJobs.genericFailure')}
        </MutedText>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {job.status === 'ready' && <PrimaryButton title={t('importJobs.reviewNow')} onPress={() => onReview(job)} />}
        {(job.status === 'failed' || stranded) && (
          <PrimaryButton title={t('importScreen.retryImport')} onPress={() => onRetry(job)} loading={retrying} />
        )}
        {(job.status === 'ready' || job.status === 'failed' || stranded) && (
          <SecondaryButton title={t('common.dismiss')} onPress={() => onDismiss(job)} />
        )}
      </View>
    </Card>
  );
}

export default function ImportJobsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobsQuery = useImportJobs();
  const retryJob = useRetryImportJob();
  const dismissJob = useDismissImportJob();
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [preparingReviewAll, setPreparingReviewAll] = useState(false);

  useFocusEffect(() => {
    // A cheap, deliberate extra refetch on focus (on top of the hook's
    // own polling) — landing on this screen from a "ready"/"failed" chip
    // tap should show up-to-the-second state immediately, not wait for
    // the next poll tick.
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

  async function handleRetry(job: ImportJob) {
    setRetryingId(job.id);
    try {
      await retryJob.mutateAsync({ jobId: job.id });
    } catch (err) {
      Alert.alert(t('importJobs.retryFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setRetryingId(null);
    }
  }

  function handleDismiss(job: ImportJob) {
    Alert.alert(t('importJobs.dismissConfirmTitle'), t('importJobs.dismissConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.dismiss'), style: 'destructive', onPress: () => dismissJob.mutate(job.id) },
    ]);
  }

  const jobs = sortImportJobsForDisplay(jobsQuery.data ?? []);
  // BATCH REVIEW FLOW (owner decision, spec item 3: "'3 documents ready to
  // review' -> confirm them one after another with Next/Skip without
  // returning to the queue between each") — 2+ ready jobs at once is what
  // makes a walkthrough worth offering over reviewing each one
  // individually; the single-job "Review Now" button on each row (unchanged)
  // still covers the one-ready-job case.
  const readyJobs = jobs.filter((j) => j.status === 'ready');

  // MULTI-FILE IMPORT ORDER vs DISPLAY ORDER (owner decision) — the queue
  // order Review All used to send was `readyJobs`' own creation-time
  // order, not each document's own date. Fetches every ready job's own
  // extracted date (already-completed extractions, one read each — cheap,
  // bounded by however many are actually ready) and reorders via
  // sortJobIdsByDocumentDate() before navigating, so the batch review
  // walkthrough always presents newest-document-first regardless of which
  // job happened to finish processing first.
  async function handleReviewAll() {
    setPreparingReviewAll(true);
    try {
      const withDates = await Promise.all(
        readyJobs.map(async (j) => {
          const extraction = await fetchImportJobResult(j.id).catch(() => null);
          return { id: j.id, date: extraction ? getPrimaryExtractionDate(extraction) || null : null };
        })
      );
      const orderedIds = sortJobIdsByDocumentDate(withDates);
      router.push({ pathname: '/(tabs)/import', params: { reviewJobIds: orderedIds.join(',') } } as unknown as Href);
    } finally {
      setPreparingReviewAll(false);
    }
  }

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
          <>
            {readyJobs.length >= 2 && (
              <PrimaryButton
                title={t('importJobs.reviewAll', { count: readyJobs.length })}
                onPress={handleReviewAll}
                loading={preparingReviewAll}
              />
            )}
            {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onReview={handleReview}
              onRetry={handleRetry}
              onDismiss={handleDismiss}
              retrying={retryingId === job.id}
            />
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
