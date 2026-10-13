import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  useImportJobs,
  useRetryImportJob,
  useDismissImportJob,
  useAnswerImportJob,
  fetchImportJobResult,
  IMPORT_JOBS_QUERY_KEY,
} from '@/src/data/importJobs';
import {
  sortImportJobsForDisplay,
  sortJobIdsByDocumentDate,
  jobProgressFraction,
  jobProgressView,
  resumeFromPage,
  type ImportJob,
  type JobProgressView,
} from '@/src/import/importJobs';
import { jobProgressText, jobStatusLabel } from '@/src/components/importJobText';
import { getPrimaryExtractionDate } from '@/src/import/dateGuard';
import { Screen, Card, MutedText, SecondaryButton, PrimaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// BACKGROUND IMPORT (owner decision 2026-08-24, item 4 "multiple imports
// queue up... show them as a small list with per-item status and retry")
// — reads the SAME useImportJobs() polling hook the persistent chip does
// (react-query dedupes by query key, so mounting both never doubles the
// real network polling).
//
// RESUMABLE IMPORT JOBS (owner decision 2026-10-13, 17-page stall
// redesign): every row says where the job is in words ("Reading settlement
// page 3 of 6 · 12 attachments queued · 1:42"); a job whose heartbeat
// stopped says "Interrupted at page N" with "Resume from page N"; a failed
// job names the page, the run and the cause; never a bare "stuck".
function statusColor(view: JobProgressView): string {
  switch (view.state) {
    case 'ready':
      return colors.green;
    case 'failed':
      return colors.red;
    case 'interrupted':
    case 'waiting':
    case 'question':
      return colors.orange;
    default:
      return colors.accent;
  }
}

function contentFraction(job: ImportJob): number | null {
  const p = job.progress;
  if (p && p.contentTotal > 0) return Math.min(1, Math.max(0, (p.contentDone + p.contentFailed) / p.contentTotal));
  return jobProgressFraction(job);
}

function JobRow({
  job,
  onReview,
  onResume,
  onAnswer,
  onDismiss,
  busy,
}: {
  job: ImportJob;
  onReview: (job: ImportJob) => void;
  onResume: (job: ImportJob) => void;
  onAnswer: (job: ImportJob, answer: 'read_first' | 'cancel') => void;
  onDismiss: (job: ImportJob) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const view = jobProgressView(job, new Date().toISOString());
  const color = statusColor(view);
  const fraction = contentFraction(job);
  const resumePage = resumeFromPage(job);
  const working = ['starting', 'whole', 'classifying', 'reading', 'between_runs', 'attachments'].includes(view.state);

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {job.fileName ?? t('importJobs.untitledFile')}
        </Text>
        <Text style={{ color, fontWeight: '700', fontSize: typography.size.xs }}>{jobStatusLabel(job, view, t)}</Text>
      </View>

      {working && (
        <View style={{ marginBottom: spacing.xs }}>
          {fraction != null && view.state !== 'attachments' ? (
            <View style={{ height: 6, borderRadius: radii.sm, backgroundColor: colors.card2, overflow: 'hidden', marginBottom: 2 }}>
              <View style={{ height: '100%', width: `${Math.round(fraction * 100)}%`, backgroundColor: colors.accent }} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActivityIndicator size="small" color={colors.accent} style={{ marginEnd: spacing.xs }} />
            <MutedText style={{ flex: 1 }}>
              {job.progress || view.state !== 'starting' ? jobProgressText(view, t) : t('importJobs.starting')}
            </MutedText>
          </View>
        </View>
      )}

      {view.state === 'waiting' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <ActivityIndicator size="small" color={colors.orange} style={{ marginEnd: spacing.xs }} />
          <MutedText style={{ color: colors.orange, flex: 1 }}>{jobProgressText(view, t)}</MutedText>
        </View>
      )}

      {view.state === 'question' && (
        <View style={{ marginBottom: spacing.xs }}>
          <MutedText style={{ color: colors.orange, marginBottom: spacing.xs }}>{jobProgressText(view, t)}</MutedText>
          <MutedText style={{ marginBottom: spacing.xs }}>{t('importJobs.pageCapNote', { cap: view.cap, rest: view.totalPages - view.cap })}</MutedText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <PrimaryButton title={t('importJobs.readFirst', { cap: view.cap })} onPress={() => onAnswer(job, 'read_first')} loading={busy} />
            <SecondaryButton title={t('importJobs.dontRead')} onPress={() => onAnswer(job, 'cancel')} />
          </View>
        </View>
      )}

      {view.state === 'interrupted' && (
        <MutedText style={{ color: colors.orange, marginBottom: spacing.xs }}>
          {jobProgressText(view, t)} — {t('importJobs.interruptedNote')}
        </MutedText>
      )}

      {view.state === 'failed' && (
        <MutedText style={{ color: colors.red, marginBottom: spacing.xs }}>
          {view.failure ? jobProgressText(view, t) : job.errorMessage ?? t('importJobs.genericFailure')}
        </MutedText>
      )}

      {view.state === 'ready' && view.attachmentsQueued > 0 && (
        <MutedText style={{ marginBottom: spacing.xs }}>{t('importJobs.attachmentsStillReading', { count: view.attachmentsQueued })}</MutedText>
      )}
      {(view.state === 'ready' || view.state === 'attachments') && (job.progress?.storedPages.length ?? 0) > 0 && (
        <MutedText style={{ marginBottom: spacing.xs }}>{t('importJobs.storedPagesNote', { pages: job.progress!.storedPages.join(', ') })}</MutedText>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {job.status === 'ready' && <PrimaryButton title={t('importJobs.reviewNow')} onPress={() => onReview(job)} />}
        {(view.state === 'failed' || view.state === 'interrupted') && (
          <PrimaryButton
            title={resumePage != null ? t('importJobs.resumeFromPage', { page: resumePage }) : t('importJobs.resume')}
            onPress={() => onResume(job)}
            loading={busy}
          />
        )}
        {(job.status === 'ready' || view.state === 'failed' || view.state === 'interrupted') && (
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
  const answerJob = useAnswerImportJob();
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

  // "Resume from page N": the same job continues; finished pages are kept.
  async function handleResume(job: ImportJob) {
    setRetryingId(job.id);
    try {
      await retryJob.mutateAsync({ jobId: job.id });
    } catch (err) {
      Alert.alert(t('importJobs.retryFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setRetryingId(null);
    }
  }

  async function handleAnswer(job: ImportJob, answer: 'read_first' | 'cancel') {
    setRetryingId(job.id);
    try {
      await answerJob.mutateAsync({ jobId: job.id, answer });
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
              onResume={handleResume}
              onAnswer={handleAnswer}
              onDismiss={handleDismiss}
              busy={retryingId === job.id}
            />
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
