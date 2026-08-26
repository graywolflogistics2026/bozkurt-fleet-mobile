import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useInsertTruck } from '@/src/data/trucks';
import { useDrivers, useInsertDriver } from '@/src/data/drivers';
import { useUserCategories } from '@/src/data/userCategories';
import { useCategoryLearningRules } from '@/src/data/categoryLearningRules';
import { useCarrierCodeMaps } from '@/src/data/carrierCodeMaps';
import { callAiImport, friendlyAiImportError, buildAiImportErrorReport, type AiImportError } from '@/src/data/aiImportCall';
import {
  useStartImportJob,
  useStartImportJobsBatch,
  useDismissImportJob,
  fetchImportJobForReview,
  downloadImportJobFileToLocal,
  type BatchStartResult,
} from '@/src/data/importJobs';
import { nextBatchReviewStep, MAX_BATCH_IMPORT_FILES } from '@/src/import/importJobs';
import { classifyAiImportFailureCategory } from '@/src/import/friendlyAiFailure';
import { useAiFailureTracker } from '@/src/data/serviceStatus';
import { ServiceStatusBanner } from '@/src/components/ServiceStatusBanner';
import { detectBackfillSession, planBatchImportCapacity } from '@/src/usage/aiUsage';
import { useAiUsageDisplay } from '@/src/data/aiUsageDisplay';
import { useProfile } from '@/src/data/profile';
import { isOwnerAccount } from '@/src/entitlement/hasFullAccess';
import { fetchExistingDocsForDuplicateCheck, findExistingSettlement, saveExtraction, type SaveExtractionResult } from '@/src/data/aiImportSave';
import { isSaveExtractionError, buildErrorReport } from '@/src/data/saveExtractionError';
import { groupStepForDisplay, type DisplayStepGroup } from '@/src/import/errorStepGroups';
import { buildAndUploadBackupSnapshot } from '@/src/data/backupSnapshot';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { checkDuplicateImport, type DuplicateCheckResult } from '@/src/import/duplicateCheck';
import { getPrimaryExtractionDate, isOlderThanMonths, isSettlementWeekEndingMissing, withPrimaryExtractionDate } from '@/src/import/dateGuard';
import { checkSettlementReconciliation } from '@/src/import/settlementReconciliation';
import { applyDefaultPerDiemDays, withPerDiemDays } from '@/src/tax/perDiem';
import { resolveTruckMatch } from '@/src/import/truckMatch';
import { resolveDriverMatch } from '@/src/import/driverMatch';
import { isPersonalPayment, normalizePaymentMethod, withPaymentMethod, PAYMENT_METHODS } from '@/src/import/paymentMethods';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { useDocTypeMeta } from '@/src/import/docTypes';
import { CategoryPicker } from '@/src/components/CategoryPicker';
import { consumePendingCapture } from '@/src/import/pendingCapture';
import type { Extraction } from '@/src/import/types';
import { Screen, ScreenTitle, Card, MutedText, PrimaryButton, SecondaryButton, ErrorText, Field } from '@/src/components/ui';
import { formatMoney } from '@/src/i18n/format';
import { getBuildInfo, formatBuildInfoLine } from '@/src/lib/buildInfo';
import { colors, radii, spacing, typography } from '@/src/theme';

type Phase = 'pick' | 'working' | 'preview' | 'saving' | 'done' | 'error';

// PDF/FILE SIZE GUARD (pre-launch hardening, owner decision 2026-08-02):
// reject an oversized file before ever base64-encoding/uploading it —
// base64 inflates the payload ~33%, and a huge upload either times out or
// produces a cryptic server error. 10 MB comfortably covers any real
// carrier settlement/receipt scan while still catching a genuinely
// oversized file early with a friendly message. The same limit is
// enforced again server-side in ai-import (belt and suspenders — a client
// bug/bypass must never be the only thing standing between a huge
// request and the Edge Function).
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function money(n: number | undefined | null, locale: string) {
  if (n == null) return '—';
  return formatMoney(n, locale);
}

// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02): a local
// (client-side, pre-network) failure — reading/compressing a picked
// file — has no "step"/postgres-shaped error to report, but still gets
// the same Copy Details treatment for consistency, using whatever the
// JS runtime actually threw.
function buildLocalErrorReport(stepDescription: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? `\n\nStack:\n${err.stack}` : '';
  return `Build: ${formatBuildInfoLine(getBuildInfo())}\nFailed step: ${stepDescription}\nError: ${message}${stack}`;
}

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

type PreviewLine = { label: string; value: string; color?: string };

function buildPreviewLines(d: Extraction, t: TFunction, locale: string): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const p1 = 'importScreen.previewLabels';
  if (d.docType === 'settlement' && d.settlement) {
    const s = d.settlement;
    lines.push({ label: t(`${p1}.grossRevenue`), value: money(s.grossRevenue, locale), color: colors.green });
    lines.push({ label: t(`${p1}.netPay`), value: money(s.netPay, locale), color: colors.accent });
    lines.push({ label: t(`${p1}.deductions`), value: money(s.totalDeductions, locale), color: colors.red });
    lines.push({ label: t(`${p1}.milesLabel`), value: t(`${p1}.miles`, { count: s.totalMiles ?? 0 }) });
    lines.push({ label: t(`${p1}.loadsLabel`), value: t(`${p1}.loads`, { count: (s.loads ?? []).length }) });
    const tractorFuel = (s.tractorFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    const reeferFuel = (s.reeferFuel ?? []).reduce((a, x) => a + (x.amount ?? 0), 0);
    if (tractorFuel) lines.push({ label: t(`${p1}.tractorFuel`), value: money(tractorFuel, locale), color: colors.red });
    if (reeferFuel) lines.push({ label: t(`${p1}.reeferFuel`), value: money(reeferFuel, locale), color: colors.red });
    for (const x of (s.deductions ?? []).slice(0, 4)) {
      lines.push({ label: `${x.code ?? ''} ${x.desc ?? ''}`.trim(), value: money(x.amount, locale), color: colors.red });
    }
  } else if (d.docType === 'fuel' && d.fuel) {
    const f = d.fuel;
    lines.push({ label: t(`${p1}.type`), value: f.type ?? '—' });
    lines.push({ label: t(`${p1}.station`), value: f.station ?? '—' });
    lines.push({ label: t(`${p1}.gallonsLabel`), value: t(`${p1}.gallons`, { count: Number((f.gallons ?? 0).toFixed(1)) }) });
    lines.push({ label: t(`${p1}.gross`), value: money(f.gross, locale), color: colors.red });
    lines.push({ label: t(`${p1}.discount`), value: money(f.discount, locale), color: colors.green });
    lines.push({ label: t(`${p1}.net`), value: money(f.net, locale), color: colors.red });
  } else if ((d.docType === 'amazon' || d.docType === 'store') && d.purchase) {
    const p = d.purchase;
    for (const item of p.items ?? []) {
      const qty = Math.max(1, parseInt(String(item.qty ?? 1), 10) || 1);
      const label = qty > 1 ? `${qty}× ${item.name ?? ''} (@${money(item.price, locale)} each)` : item.name ?? '';
      lines.push({ label, value: money((item.price ?? 0) * qty, locale), color: colors.accent });
    }
    if (p.tax) lines.push({ label: t(`${p1}.tax`), value: money(p.tax, locale), color: colors.red });
    lines.push({ label: t(`${p1}.total`), value: money(p.total ?? d.totalAmount, locale), color: colors.green });
    if (p.paymentMethod) {
      const personal = isPersonalPayment(p.paymentMethod);
      lines.push({
        label: t(`${p1}.paymentMethod`),
        value: personal ? t(`${p1}.paymentMethodContribution`, { method: p.paymentMethod }) : p.paymentMethod,
        color: personal ? colors.orange : colors.muted,
      });
    }
  } else if (d.docType === 'maintenance' && d.maintenance) {
    const m = d.maintenance;
    lines.push({ label: t(`${p1}.shop`), value: m.shop ?? '—' });
    lines.push({ label: t(`${p1}.invoice`), value: m.invoice ?? '—' });
    lines.push({
      label: t(`${p1}.odometerLabel`),
      value: m.odometer ? t(`${p1}.odometer`, { count: m.odometer }) : '—',
    });
    lines.push({ label: t(`${p1}.totalCost`), value: money(m.total, locale), color: colors.red });
    if (m.warrantyCredit) lines.push({ label: t(`${p1}.warrantyCredit`), value: money(m.warrantyCredit, locale), color: colors.green });
  } else if (d.docType === 'driver_payment' && d.driverPayment) {
    const p = d.driverPayment;
    lines.push({ label: t(`${p1}.driver`), value: p.driverName || '—' });
    lines.push({ label: t(`${p1}.total`), value: money(p.amount ?? d.totalAmount, locale), color: colors.red });
    if (p.method) lines.push({ label: t(`${p1}.method`), value: p.method });
  } else if (d.financialDoc) {
    const f = d.financialDoc;
    lines.push({ label: t(`${p1}.description`), value: f.description || d.summary || '—' });
    lines.push({ label: t(`${p1}.total`), value: money(f.amount ?? d.totalAmount, locale), color: colors.red });
    if (f.reference) lines.push({ label: t(`${p1}.reference`), value: f.reference });
    if (f.period) lines.push({ label: t(`${p1}.period`), value: f.period });
  } else if (d.docType === 'other') {
    // Category line intentionally NOT pushed here — it's rendered as an
    // editable CategoryPicker instead (PROMPTS.md Session 9a item 9, custom
    // category picker; this used to be a read-only suggestedCategory line).
    lines.push({ label: t(`${p1}.total`), value: money(d.totalAmount, locale), color: colors.red });
  }
  return lines;
}

export default function Import() {
  const { t, i18n } = useTranslation();
  const docTypeMeta = useDocTypeMeta();
  const router = useRouter();
  const { session } = useAuth();
  const { trucks, refreshTrucks } = useActiveTruck();
  const { data: driversData } = useDrivers();
  const drivers = driversData ?? [];
  // Custom categories (owner decision 2026-07-10, PRODUCT DECISION): the
  // user's own active category names, forwarded to ai-import so
  // classification can suggest one of these too, not just the canonical
  // taxonomy (docs/INDUSTRY_TAXONOMY.md §B). "+ New category" UI itself is
  // PROMPTS.md Session 9a — this is just the ai-import awareness plumbing.
  const { data: userCategoriesData } = useUserCategories({ active: true });
  const customCategoryNames = (userCategoriesData ?? []).map((c) => c.name);
  // CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
  // follow-up item G) — forwarded to ai-import as plain prompt-context
  // "USER CORRECTIONS" hints, never used to train/fine-tune any model.
  const { data: learningRulesData } = useCategoryLearningRules();
  const learningRules = (learningRulesData ?? []).map((r) => ({ keyword: r.keyword, category: r.category }));
  // CARRIER-SCOPED PAYROLL/SETTLEMENT CODES pass (owner decision) —
  // forwarded into ai-import's prompt (each carrier wrapped in its own
  // "confirm this carrier before applying" instruction, see
  // buildExtractionPrompt() in supabase/functions/ai-import/index.ts).
  const { data: carrierCodeMaps } = useCarrierCodeMaps();
  const insertTruck = useInsertTruck();
  const insertDriver = useInsertDriver();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  // COST CONTROL & GRACEFUL DEGRADATION (owner decision 2026-08-24, FIVE
  // ADDITIONS pass, PART 4 item 3) — tracks consecutive ai-import
  // failures on this device for the automatic fallback banner.
  const aiFailureTracker = useAiFailureTracker();
  // BACKGROUND IMPORT (owner decision 2026-08-24) — see startBackgroundJob()
  // below (pickPdf's own path) and the reviewJobId effect further down
  // ("Review now", opened from the jobs list / persistent chip).
  const startImportJob = useStartImportJob();
  // MULTI-FILE BACKGROUND IMPORT (owner decision, "batch enqueue" pass) —
  // starts several jobs at once (one per picked file), and lets the jobs
  // list (or a "Review All" tap) route a whole batch of ready jobs through
  // this SAME screen's review flow via ?reviewJobIds=a,b,c.
  const startImportJobsBatch = useStartImportJobsBatch();
  const dismissImportJob = useDismissImportJob();
  const { reviewJobId, reviewJobIds } = useLocalSearchParams<{ reviewJobId?: string; reviewJobIds?: string }>();
  const profileQuery = useProfile();
  const isOwner = isOwnerAccount(profileQuery.data);
  const aiUsage = useAiUsageDisplay(isOwner);

  const [phase, setPhase] = useState<Phase>('pick');
  const [workingLabel, setWorkingLabel] = useState('');
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [fileMeta, setFileMeta] = useState<{ uri: string; ext: string; mediaType: string; name?: string } | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCheckResult | null>(null);
  const [existingSettlementWeek, setExistingSettlementWeek] = useState<{ id: string; business_balance_credit: number | null } | null>(null);
  const [truckId, setTruckId] = useState<string | null>(null);
  const [needsTruckPicker, setNeedsTruckPicker] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [needsDriverPicker, setNeedsDriverPicker] = useState(false);
  const [showNewTruckForm, setShowNewTruckForm] = useState(false);
  const [newTruckUnit, setNewTruckUnit] = useState('');
  const [creatingTruck, setCreatingTruck] = useState(false);
  const [showNewDriverForm, setShowNewDriverForm] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [creatingDriver, setCreatingDriver] = useState(false);
  const [driverShareAmount, setDriverShareAmount] = useState('');
  const [categoryOverride, setCategoryOverride] = useState('');
  // PAGES-PROCESSED NOTE (owner decision 2026-08-03): set whenever
  // ai-import didn't cover every page of the original document — see
  // aiImportCall.ts's AiImportCallResult.pagesProcessed for the full
  // reasoning. `missingPages` lists the specific pages that failed even
  // after the server's own retry (gaps are possible; a missing middle
  // page no longer means later pages were lost too). Shown as a plain
  // banner on the preview screen so the user knows exactly what was and
  // wasn't imported, rather than a silently incomplete-looking result.
  const [pagesProcessedNote, setPagesProcessedNote] = useState<{ total: number; missingPages: number[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // RICH IMPORT ERROR REPORTING (owner decision 2026-08-02, device
  // feedback: "settlement imports failing frequently"): instead of one
  // generic "save failed" string, the error card now shows WHICH step
  // failed (grouped into a user-legible bucket, errorStepGroup — the
  // exact granular step is still in errorReport for support/debugging),
  // whether records may already be partially saved, and a "Copy Details"
  // button carrying the full raw report (build info, exact step, error
  // message/code/hint). null when the current error is a simple
  // validation-style rejection with nothing more useful to add.
  const [errorStepGroup, setErrorStepGroup] = useState<DisplayStepGroup | null>(null);
  const [errorHasPartialSave, setErrorHasPartialSave] = useState(false);
  const [errorIsDuplicateRace, setErrorIsDuplicateRace] = useState(false);
  const [errorReport, setErrorReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-tap guard (owner decision 2026-08-02, §34/§37 unique-index
  // audit): a ref (not state) so it's read/set synchronously within the
  // same event-handler call, closing the narrow window where two fast
  // taps on Save before React re-renders could both start
  // saveExtraction() concurrently — the second attempt racing the first
  // insert-vs-update decision and hitting the settlements unique index.
  const savingRef = useRef(false);
  const [result, setResult] = useState<SaveExtractionResult | null>(null);
  // BATCH REVIEW FLOW (owner decision, "3 documents ready to review ->
  // Next/Skip without returning to the queue between each" pass) —
  // `currentReviewId` is the one id the existing review-loading effect
  // below acts on (single-job reviews and batch reviews both funnel
  // through it); `batchQueue` holds whatever ids are still left AFTER the
  // current one; `batchTotal`/`batchPosition` (0/0 outside batch mode)
  // drive the "Reviewing N of M" progress line and the Next/Skip button
  // wiring. batchTotal > 0 is the one flag every batch-aware bit of UI
  // below checks.
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null);
  const [batchQueue, setBatchQueue] = useState<string[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchPosition, setBatchPosition] = useState(0);
  // USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
  // FIVE ADDITIONS pass, PART 5 item 5) — "contextually when someone is
  // clearly back-filling" — a plain in-session list of this session's own
  // saved-document dates (not persisted; a fresh session starts clean),
  // shown at most once per session.
  const sessionImportedDatesRef = useRef<string[]>([]);
  const backfillOfferShownRef = useRef(false);
  // "STILL WORKING" PROGRESS STATE (owner decision 2026-08-02, device
  // evidence: "The AI service took too long to respond" on real 8-page
  // Prime settlements — the bare spinner gave no signal the app hadn't
  // frozen during a genuinely long, multi-minute chunked extraction).
  // Swaps workingLabel to a reassuring "still working" message once the
  // AI call has been running long enough that the user might otherwise
  // wonder if it's stuck — cleared the moment the call actually resolves,
  // success or failure, so it never lingers into a later phase.
  const workingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [copyLabel, copiedLabel] = [t('common.copyDetails'), t('common.copied')];

  async function handleCopyDetails() {
    if (!errorReport) return;
    try {
      await Clipboard.setStringAsync(errorReport);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard failing is not itself worth a second error UI for — the
      // report text is still visible/selectable on screen regardless.
    }
  }

  useFocusEffect(() => {
    const uri = consumePendingCapture();
    if (uri) processImage(uri);
  });

  // BATCH REVIEW FLOW (owner decision) — (re)derives currentReviewId
  // (plus the batch queue/progress) from whichever route param is present,
  // every time either one changes: `reviewJobIds` (a "Review All" tap —
  // comma-separated ready-job ids, batch mode) takes priority over a plain
  // `reviewJobId` (the pre-existing single-job "Review Now" path,
  // unchanged, batchTotal stays 0). This is the ONE place either param is
  // read — the loading effect right below acts only on currentReviewId,
  // so single-job and batch reviews share the exact same load/save/dismiss
  // code path per document.
  useEffect(() => {
    if (reviewJobIds) {
      const ids = reviewJobIds.split(',').filter(Boolean);
      if (ids.length > 0) {
        const { next, remaining } = nextBatchReviewStep(ids);
        setBatchTotal(ids.length);
        setBatchPosition(1);
        setBatchQueue(remaining);
        setCurrentReviewId(next);
        return;
      }
    }
    if (reviewJobId) {
      setBatchTotal(0);
      setBatchPosition(0);
      setBatchQueue([]);
      setCurrentReviewId(reviewJobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewJobId, reviewJobIds]);

  // BATCH REVIEW FLOW — advances to the next queued document (Skip, or
  // after a successful Save) without ever returning to the jobs list in
  // between (spec item 3). reset() clears every per-document field
  // (extraction, fileMeta, phase -> 'pick', ...) but deliberately never
  // touches batch state itself — this function is what moves batch state
  // forward; reset() alone is still used for the ordinary single-document
  // Discard/Import Another actions, which are never shown while
  // batchTotal > 0 (see the render below).
  function advanceBatchReview() {
    const { next, remaining } = nextBatchReviewStep(batchQueue);
    reset();
    if (next) {
      setBatchQueue(remaining);
      setBatchPosition((p) => p + 1);
      setCurrentReviewId(next);
    } else {
      setBatchTotal(0);
      setBatchPosition(0);
      setCurrentReviewId(null);
      router.push('/(tabs)');
    }
  }

  // "REVIEW NOW" (owner decision 2026-08-24, item 3) — opened from the
  // jobs list/persistent chip via ?reviewJobId=X. Loads the completed
  // background job's already-sanitized result_json and feeds it through
  // the EXACT SAME afterExtraction() a live synchronous extraction uses
  // — duplicate check, truck/driver match, category confirm, the
  // reconciliation guard, all identical regardless of which path produced
  // the data. Nothing is auto-saved here; the user still confirms on the
  // normal preview screen.
  //
  // SAFE WHEN THE ORIGINATING SCREEN IS GONE (owner decision 2026-08-24,
  // BACKGROUND IMPORT CRASH fix, requirement #3): every value this effect
  // acts on — `job` — is read FRESH from the `import_jobs` row via
  // fetchImportJobForReview()/downloadImportJobFileToLocal(), never from a
  // closure captured back when some OTHER screen originally called
  // startBackgroundJob(). This effect can run correctly in a completely
  // fresh mount of this screen (a different app session, after a restart)
  // with zero dependency on whatever happened when the job was started.
  // `cancelled` still guards every setState call after an await, so if
  // THIS screen itself unmounts mid-load (the user navigates away while
  // the file is still downloading), nothing tries to update state on an
  // unmounted component.
  useEffect(() => {
    if (!currentReviewId || !userId) return;
    let cancelled = false;
    (async () => {
      setPhase('working');
      setWorkingLabel(t('common.loading'));
      try {
        const job = await fetchImportJobForReview(currentReviewId);
        if (cancelled) return;
        if (!job) {
          setErrorMessage(t('importJobs.reviewNotReady'));
          setErrorStepGroup(null);
          setErrorHasPartialSave(false);
          setErrorIsDuplicateRace(false);
          setErrorReport(null);
          setPhase('error');
          return;
        }
        // CRITICAL: handleSave() requires fileMeta to be set (it's how
        // Save knows what to re-upload to the final storage path) — the
        // ORIGINAL local file from whatever session started this job may
        // be long gone by now, so this downloads the job's own already-
        // uploaded copy back into a fresh local temp file. Without this,
        // Save would silently no-op on a job-sourced review (fileMeta
        // would stay null forever).
        const ext = job.mediaType.startsWith('image/') ? 'jpg' : 'pdf';
        const localUri = await downloadImportJobFileToLocal(job.storagePath, job.fileName);
        if (cancelled) return;
        setFileMeta({ uri: localUri, ext, mediaType: job.mediaType, name: job.fileName });
        await afterExtraction(job.extraction, job.fileName, undefined);
      } catch (err) {
        if (cancelled) return;
        // ERROR SURFACE FIX (owner decision 2026-08-24, requirement #5):
        // this is the exact path that used to show a raw, cryptic runtime
        // error ("undefined is not a function") as the ONLY visible text —
        // now always a friendly, step-tagged headline; the real message
        // and stack still go into errorReport for Copy Details, unchanged.
        setErrorMessage(t('importJobs.reviewLoadFailed'));
        setErrorStepGroup(null);
        setErrorHasPartialSave(false);
        setErrorIsDuplicateRace(false);
        setErrorReport(buildLocalErrorReport('Loading the completed import job', err));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentReviewId, userId]);

  function reset() {
    setPhase('pick');
    setExtraction(null);
    setFileMeta(null);
    setDuplicates(null);
    setExistingSettlementWeek(null);
    setTruckId(null);
    setNeedsTruckPicker(false);
    setDriverId(null);
    setNeedsDriverPicker(false);
    setShowNewTruckForm(false);
    setNewTruckUnit('');
    setShowNewDriverForm(false);
    setNewDriverName('');
    setDriverShareAmount('');
    setCategoryOverride('');
    setPagesProcessedNote(null);
    setErrorMessage(null);
    setErrorStepGroup(null);
    setErrorHasPartialSave(false);
    setErrorIsDuplicateRace(false);
    setErrorReport(null);
    setCopied(false);
    setResult(null);
  }

  // DUPLICATE-WEEK UX (owner decision 2026-07-30, blocks-beta fix): before
  // the user ever taps Save, tell them plainly when the settlement's
  // corrected week_ending (+ matched truck) already has a settlement on
  // file, so a replace is never a surprise. Re-checks whenever the date
  // field is edited or the truck picker resolves, using the exact same
  // findExistingSettlement() match key saveExtraction() itself uses — the
  // banner and the actual replace decision can never disagree.
  const settlementPrimaryDate = extraction?.docType === 'settlement' ? getPrimaryExtractionDate(extraction) : null;
  useEffect(() => {
    if (!userId || !settlementPrimaryDate) {
      setExistingSettlementWeek(null);
      return;
    }
    let cancelled = false;
    findExistingSettlement(userId, settlementPrimaryDate, truckId)
      .then((row) => {
        if (!cancelled) setExistingSettlementWeek(row);
      })
      .catch(() => {
        if (!cancelled) setExistingSettlementWeek(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, settlementPrimaryDate, truckId]);

  // Payroll auto-routing (owner decision 2026-07-09, PRODUCT DECISION): a
  // newly created truck/driver is picked immediately and, for trucks, the
  // shared ActiveTruckContext list is refreshed so it's available
  // everywhere else in the app right away — "remembers it" for future
  // imports is then just the normal unit_number/name match next time.
  async function handleCreateTruck() {
    const unit = newTruckUnit.trim();
    if (!userId || !unit || creatingTruck) return;
    setCreatingTruck(true);
    try {
      const created = await insertTruck.mutateAsync({ user_id: userId, unit_number: unit });
      await refreshTrucks();
      setTruckId(created.id);
      setNeedsTruckPicker(false);
      setShowNewTruckForm(false);
      setNewTruckUnit('');
    } catch (err) {
      Alert.alert(t('importScreen.createTruckFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setCreatingTruck(false);
    }
  }

  async function handleCreateDriver() {
    const name = newDriverName.trim();
    if (!userId || !name || creatingDriver) return;
    setCreatingDriver(true);
    try {
      const created = await insertDriver.mutateAsync({ user_id: userId, name });
      setDriverId(created.id);
      setNeedsDriverPicker(false);
      setShowNewDriverForm(false);
      setNewDriverName('');
    } catch (err) {
      Alert.alert(t('importScreen.createDriverFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setCreatingDriver(false);
    }
  }

  // Fires once, after `delayMs`, swapping workingLabel to the "still
  // working — large documents can take a couple of minutes" message.
  // 15s comfortably covers a normal single-page call (which finishes long
  // before then) while still kicking in well before a multi-page chunked
  // extraction's real, much longer runtime.
  function startStillWorkingTimer(delayMs = 15_000) {
    clearStillWorkingTimer();
    workingTimerRef.current = setTimeout(() => {
      setWorkingLabel(t('importScreen.stillWorkingLargeDoc'));
    }, delayMs);
  }
  function clearStillWorkingTimer() {
    if (workingTimerRef.current) {
      clearTimeout(workingTimerRef.current);
      workingTimerRef.current = null;
    }
  }
  useEffect(() => () => clearStillWorkingTimer(), []);

  function handleAiError(err: AiImportError) {
    // A usage-limit block isn't a service failure — never counts toward
    // the automatic "the AI service seems to be down" fallback banner.
    if (err.type !== 'usage_limit_reached') aiFailureTracker.recordFailure();
    // COST CONTROL & GRACEFUL DEGRADATION (owner decision 2026-08-24, FIVE
    // ADDITIONS pass, PART 4 item 2) — billing/auth, rate-limit, timeout/
    // overload, and offline all get ONE shared, friendly, localized
    // message per category (src/import/friendlyAiFailure.ts) instead of
    // the raw underlying error; every other type keeps its own existing,
    // already-specific message. The USAGE LIMIT (PART 5) gets its own
    // dedicated message — it already carries the exact real "X of Y"
    // figures from the server (usage_limit_reached's `used`/`allowance`
    // extras), never a generic bucket.
    if (err.type === 'usage_limit_reached') {
      setErrorMessage(
        err.used != null && err.allowance != null
          ? t('importScreen.usageLimitReached', { used: err.used, allowance: err.allowance })
          : t('importScreen.usageLimitReachedGeneric')
      );
    } else {
      const category = classifyAiImportFailureCategory(err.type);
      // 'oversized' reuses the EXISTING fileTooLargeMessage copy (already
      // translated in all 7 locales, already the exact "size guidance"
      // wording) instead of a second, duplicate translated string.
      if (category === 'oversized') {
        setErrorMessage(t('importScreen.fileTooLargeMessage'));
      } else {
        setErrorMessage(category ? t(`importScreen.friendlyFailure.${category}`) : friendlyAiImportError(err));
      }
    }
    setErrorStepGroup(null);
    setErrorHasPartialSave(false);
    setErrorIsDuplicateRace(false);
    setErrorReport(buildAiImportErrorReport(err, formatBuildInfoLine(getBuildInfo())));
    setPhase('error');
  }

  async function afterExtraction(d: Extraction, fname: string | undefined, pagesProcessed?: { total: number; missingPages: number[] }) {
    if (!userId) return;
    aiFailureTracker.recordSuccess();
    setPagesProcessedNote(pagesProcessed ?? null);
    const existingDocs = await fetchExistingDocsForDuplicateCheck(userId);
    setDuplicates(checkDuplicateImport(d, fname, existingDocs));

    const extractedUnit = d.settlement?.unit ?? d.maintenance?.unit;
    const truckMatch = resolveTruckMatch(extractedUnit, trucks);
    setTruckId(truckMatch.truckId);
    setNeedsTruckPicker(truckMatch.needsPicker);

    const driverMatch = resolveDriverMatch(d.settlement?.driverName ?? d.driverPayment?.driverName, drivers);
    setDriverId(driverMatch.driverId);
    // Universal AI capture (owner decision 2026-07-10): unlike a settlement
    // (driver is optional metadata), driver_payments.driver_id is NOT
    // NULL — this docType always needs a driver picked, even with 0
    // drivers on file or no name extracted (resolveDriverMatch() alone
    // would say no picker needed in that case, which is right for
    // settlements but wrong here).
    setNeedsDriverPicker(driverMatch.needsPicker || (d.docType === 'driver_payment' && !driverMatch.driverId));

    setCategoryOverride(d.docType === 'other' ? d.suggestedCategory || 'Other' : '');
    // PER DIEM INTELLIGENCE (owner decision 2026-07-30): smart-default
    // per_diem_days from miles (0 miles -> 0 days "home week", else 7)
    // BEFORE the preview ever renders — editable from there on, same
    // "compute once, then it's the user's value" pattern as the week-
    // ending date field.
    setExtraction(applyDefaultPerDiemDays(d));
    setPhase('preview');
  }

  async function processImage(uri: string) {
    setPhase('working');
    setWorkingLabel(t('importScreen.compressingPhoto'));
    try {
      const compressed = await manipulateAsync(uri, [{ resize: { width: 1600 } }], {
        compress: 0.8,
        format: SaveFormat.JPEG,
      });
      const compressedSize = new File(compressed.uri).size;
      if (compressedSize > MAX_FILE_SIZE_BYTES) {
        setErrorMessage(t('importScreen.fileTooLargeMessage'));
        setErrorStepGroup(null);
        setErrorHasPartialSave(false);
        setErrorIsDuplicateRace(false);
        setErrorReport(null);
        setPhase('error');
        return;
      }
      setFileMeta({ uri: compressed.uri, ext: 'jpg', mediaType: 'image/jpeg' });
      setWorkingLabel(t('importScreen.readingDocument'));
      const base64 = await new File(compressed.uri).base64();
      setWorkingLabel(t('importScreen.aiProcessing'));
      startStillWorkingTimer();
      const { data, error, pagesProcessed } = await callAiImport(
        base64,
        'image/jpeg',
        undefined,
        i18n.language,
        customCategoryNames,
        learningRules,
        carrierCodeMaps
      );
      clearStillWorkingTimer();
      if (error) return handleAiError(error);
      if (data) await afterExtraction(data, undefined, pagesProcessed);
    } catch (err) {
      clearStillWorkingTimer();
      setErrorMessage(err instanceof Error ? err.message : t('importScreen.couldNotProcessPhoto'));
      setErrorStepGroup(null);
      setErrorHasPartialSave(false);
      setErrorIsDuplicateRace(false);
      setErrorReport(buildLocalErrorReport('Reading/compressing the photo', err));
      setPhase('error');
    }
  }

  async function pickFromGallery() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    await processImage(picked.assets[0].uri);
  }

  // BACKGROUND IMPORT (owner decision 2026-08-24) — "the real fix for
  // perceived slowness... the user should NOT sit and watch it." A PDF
  // pick (which is where a multi-page settlement's real wait time lives)
  // now uploads the file and starts a server-tracked import_jobs row
  // (app/src/data/importJobs.ts), returning the user to the app almost
  // immediately instead of a multi-minute foreground wait — progress and
  // completion are then owned by the persistent ImportJobsChip + the jobs
  // list screen (app/(tabs)/import/jobs.tsx), NOT this screen. Photo
  // imports (processImage, below) are deliberately UNCHANGED — they are
  // always a single, fast Anthropic call (never chunked/continued), so
  // there's no "perceived slowness" problem to fix there, and the existing
  // synchronous callAiImport() flow stays exactly as it was.
  async function startBackgroundJob(uri: string, mediaType: string, fileName: string) {
    setPhase('working');
    setWorkingLabel(t('importJobs.uploading'));
    try {
      await startImportJob.mutateAsync({
        fileUri: uri,
        mediaType,
        fileName,
        locale: i18n.language,
        customCategories: customCategoryNames,
        learningRules,
        carrierCodeMaps,
      });
      reset();
      Alert.alert(t('importJobs.startedTitle'), t('importJobs.startedBody'));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('importScreen.couldNotProcessFile'));
      setErrorStepGroup(null);
      setErrorHasPartialSave(false);
      setErrorIsDuplicateRace(false);
      setErrorReport(buildLocalErrorReport('Starting the background import', err));
      setPhase('error');
    }
  }

  // MULTI-FILE BACKGROUND IMPORT (owner decision, "batch enqueue" pass,
  // spec item 1) — "the picker allows selecting MULTIPLE documents at once
  // (up to 10 per batch, configurable)." A single pick (still the common
  // case) keeps using the exact pre-existing one-job flow below,
  // unchanged — multi-select only branches once 2+ files come back.
  async function pickPdf() {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: true });
    if (picked.canceled || !picked.assets?.length) return;

    let assets = picked.assets;
    if (assets.length > MAX_BATCH_IMPORT_FILES) {
      Alert.alert(t('importJobs.batchTooManyTitle'), t('importJobs.batchTooManyMessage', { max: MAX_BATCH_IMPORT_FILES }));
      assets = assets.slice(0, MAX_BATCH_IMPORT_FILES);
    }

    const validAssets: DocumentPickerAsset[] = [];
    const oversizedNames: string[] = [];
    for (const asset of assets) {
      const size = asset.size ?? new File(asset.uri).size;
      if (size > MAX_FILE_SIZE_BYTES) oversizedNames.push(asset.name);
      else validAssets.push(asset);
    }
    if (oversizedNames.length > 0) {
      Alert.alert(
        t('importScreen.fileTooLargeTitle'),
        oversizedNames.length === assets.length
          ? t('importScreen.fileTooLargeMessage')
          : t('importJobs.batchSomeFilesTooLarge', { names: oversizedNames.join(', ') })
      );
    }
    if (validAssets.length === 0) return;

    if (validAssets.length === 1) {
      const asset = validAssets[0];
      // COST CONTROL & GRACEFUL DEGRADATION precedent (owner decision
      // 2026-08-24, FIVE ADDITIONS pass) — fileMeta is set BEFORE the
      // upload/job-start call and, unlike every other error-phase field,
      // is deliberately NOT cleared until the user explicitly resets, so
      // a failed UPLOAD (as opposed to a job that started fine and later
      // failed server-side — that retries from the jobs list instead) can
      // still be retried with one tap, no re-picking required.
      setFileMeta({ uri: asset.uri, ext: 'pdf', mediaType: 'application/pdf', name: asset.name });
      await startBackgroundJob(asset.uri, 'application/pdf', asset.name);
      return;
    }

    await startBatchImport(validAssets);
  }

  // "If a batch would exceed the allowance, say up front how many will
  // process and offer the credit pack rather than silently truncating"
  // (spec item 4) — resolves to whether the user chose to continue with
  // whatever WILL fit; Cancel or "Get Credits" both resolve false (Get
  // Credits also routes to Settings, where the credit-pack offers already
  // live, PART 5 of the FIVE ADDITIONS pass).
  function confirmBatchWillBeBlocked(plan: ReturnType<typeof planBatchImportCapacity>): Promise<boolean> {
    return new Promise((resolve) => {
      const body = t('importJobs.batchLimitBody', { willProcess: plan.willProcess, batchSize: plan.batchSize });
      const buttons: { text: string; style?: 'cancel' | 'destructive' | 'default'; onPress: () => void }[] = [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        {
          text: t('importJobs.batchGetCredits'),
          onPress: () => {
            resolve(false);
            router.push('/(tabs)/more/settings' as Href);
          },
        },
      ];
      if (plan.willProcess > 0) {
        buttons.push({ text: t('importJobs.batchContinueWithN', { count: plan.willProcess }), onPress: () => resolve(true) });
      }
      Alert.alert(t('importJobs.batchLimitTitle'), body, buttons);
    });
  }

  async function startBatchImport(assets: DocumentPickerAsset[]) {
    const plan = planBatchImportCapacity(assets.length, aiUsage.usageStatus, aiUsage.availableCredits, isOwner);
    let toProcess = assets;
    if (plan.willBeBlocked > 0) {
      const proceed = await confirmBatchWillBeBlocked(plan);
      if (!proceed || plan.willProcess === 0) return;
      toProcess = assets.slice(0, plan.willProcess);
    }

    setPhase('working');
    setWorkingLabel(t('importJobs.uploadingBatch', { count: toProcess.length }));
    try {
      const results: BatchStartResult[] = await startImportJobsBatch.mutateAsync(
        toProcess.map((a) => ({
          fileUri: a.uri,
          mediaType: 'application/pdf',
          fileName: a.name,
          locale: i18n.language,
          customCategories: customCategoryNames,
          learningRules,
          carrierCodeMaps,
        }))
      );
      reset();
      const succeeded = results.filter((r) => r.jobId).length;
      const failed = results.length - succeeded;
      if (failed === 0) {
        Alert.alert(t('importJobs.batchStartedTitle'), t('importJobs.batchStartedBody', { count: succeeded }));
      } else {
        Alert.alert(t('importJobs.batchStartedTitle'), t('importJobs.batchStartedPartialBody', { succeeded, failed }));
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('importScreen.couldNotProcessFile'));
      setErrorStepGroup(null);
      setErrorHasPartialSave(false);
      setErrorIsDuplicateRace(false);
      setErrorReport(buildLocalErrorReport('Starting the background import batch', err));
      setPhase('error');
    }
  }

  async function handleRetryImport() {
    if (!fileMeta) {
      reset();
      return;
    }
    if (fileMeta.mediaType === 'image/jpeg') {
      await processImage(fileMeta.uri);
      return;
    }
    await startBackgroundJob(fileMeta.uri, fileMeta.mediaType, fileMeta.name ?? 'document.pdf');
  }

  async function handleSave() {
    // Double-tap guard (owner decision 2026-08-02, §34/§37 unique-index
    // audit): synchronous ref check-and-set, closing the gap between a
    // fast double-tap and React re-rendering the Save button away once
    // phase becomes 'saving'. A second concurrent call to handleSave()
    // for the SAME settlement week could otherwise race past
    // findExistingSettlement()'s insert-vs-update check and hit the
    // settlements table's partial unique index on INSERT.
    if (savingRef.current) return;
    if (!extraction || !fileMeta || !userId) return;
    if (needsTruckPicker && !truckId) return;
    if (needsDriverPicker && !driverId) return;
    if (isSettlementWeekEndingMissing(extraction)) return;
    // SETTLEMENT RECONCILIATION HARD GUARD (owner decision 2026-08-03) —
    // same check the Save button's `disabled` prop already renders; this
    // is defense in depth against any path that could reach handleSave()
    // without going through that button (e.g. a stale re-render racing a
    // state update), same spirit as the double-tap guard above.
    if (!checkSettlementReconciliation(extraction).ok) return;
    savingRef.current = true;

    try {
      const isPurchase = extraction.docType === 'amazon' || extraction.docType === 'store';
      // UX MEGA-PASS item D: payment method is auto-detected AND stays
      // user-editable in the preview (see the payment-method Pill row
      // below) — Save always reads whatever's currently on `extraction`,
      // which withPaymentMethod() keeps in sync with the user's own edits.
      const payMethod = normalizePaymentMethod(extraction.purchase?.paymentMethod);
      const hasPersonalPurchase = isPurchase && isPersonalPayment(payMethod);
      const createContribution = hasPersonalPurchase ? await confirmOwnerContribution(payMethod) : false;

      setPhase('saving');
      const saved = await saveExtraction({
        extraction,
        userId,
        truckId,
        driverId,
        driverShareAmount: showsDriverSplitInput ? Number(driverShareAmount) || null : null,
        fileUri: fileMeta.uri,
        fileExt: fileMeta.ext,
        mediaType: fileMeta.mediaType,
        createContribution,
        categoryOverride: extraction.docType === 'other' ? categoryOverride : null,
      });
      setResult(saved);
      setPhase('done');
      // UNBOUNDED QUERIES / SCOPED INVALIDATION FIX (P0, FULL SYSTEM AUDIT
      // owner decision 2026-08-26) — deliberately kept as the full,
      // unscoped sweep: saveExtraction() can write to any of ~10 tables
      // depending on docType (settlements + every child table, or fuel,
      // maintenance, a financial doc, compliance, driver payments, loans,
      // ...) and doesn't return which ones it actually touched — enumerating
      // that here would either be wrong for some docType or require
      // threading a new return field through aiImportSave.ts for a save
      // path that already touches most of the app's data anyway.
      await invalidateFinancialData(queryClient);
      buildAndUploadBackupSnapshot(userId); // fire-and-forget
      // BACKGROUND IMPORT (owner decision 2026-08-24) — a job-sourced save
      // (reviewJobId set) is done with its own import_jobs row now; clean
      // it up so it doesn't linger in the jobs list as a stale "ready" job
      // pointing at data that's already saved. Best-effort/fire-and-forget
      // — a failure here must never block or fail the save the user just
      // successfully completed.
      if (currentReviewId) dismissImportJob.mutate(currentReviewId);

      const savedDate = getPrimaryExtractionDate(extraction);
      if (savedDate) sessionImportedDatesRef.current.push(savedDate);
      if (!backfillOfferShownRef.current && detectBackfillSession(sessionImportedDatesRef.current)) {
        backfillOfferShownRef.current = true;
        Alert.alert(t('importScreen.backfillOfferTitle'), t('importScreen.backfillOfferBody'));
      }
    } catch (err) {
      // RICH IMPORT ERROR REPORTING (owner decision 2026-08-02): a
      // SaveExtractionError carries WHICH step failed, a snapshot of what
      // was already durably saved before that step, and (for a settlements
      // unique-index race) a distinguishable flag — see
      // saveExtractionError.ts for the full rationale. Any other thrown
      // value (shouldn't normally happen — saveExtraction() wraps every
      // write in a SaveExtractionError — but defensive regardless) falls
      // back to the same generic report every OTHER catch block in this
      // screen already builds.
      if (isSaveExtractionError(err)) {
        setErrorMessage(err.message);
        setErrorStepGroup(groupStepForDisplay(err.step));
        setErrorHasPartialSave(err.partial.documentId != null);
        setErrorIsDuplicateRace(err.isDuplicateSettlementRace);
        setErrorReport(buildErrorReport(err, formatBuildInfoLine(getBuildInfo())));
      } else {
        setErrorMessage(err instanceof Error ? err.message : t('importScreen.saveFailed'));
        setErrorStepGroup(null);
        setErrorHasPartialSave(false);
        setErrorIsDuplicateRace(false);
        setErrorReport(buildLocalErrorReport('Saving', err));
      }
      setPhase('error');
    } finally {
      savingRef.current = false;
    }
  }

  const hasDuplicate = !!duplicates && (duplicates.byContent.length > 0 || duplicates.byFilename.length > 0);
  const settlementWeekEndingMissing = extraction ? isSettlementWeekEndingMissing(extraction) : false;
  // SETTLEMENT RECONCILIATION HARD GUARD (owner decision 2026-08-03) —
  // see src/import/settlementReconciliation.ts for the full reasoning.
  // Recomputed on every extraction change, not memoized further — this
  // is a handful of arithmetic operations over a settlement's own
  // (already-in-memory) deduction array, not worth a useMemo.
  const reconciliation = checkSettlementReconciliation(extraction);
  const meta = extraction ? docTypeMeta(extraction.docType) : null;
  // Driver compensation types (owner decision 2026-07-10, PRODUCT DECISION):
  // team_split/trainee drivers get a split-entry field on the settlement
  // preview — 1099/W-2 drivers don't (their pay isn't settlement-derived).
  const selectedDriver = driverId ? drivers.find((d) => d.id === driverId) : undefined;
  const showsDriverSplitInput =
    extraction?.docType === 'settlement' &&
    !!selectedDriver &&
    (selectedDriver.compensation_type === 'team_split' || selectedDriver.compensation_type === 'trainee');

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('importScreen.title')}</ScreenTitle>

        <ServiceStatusBanner />

        {/* BATCH REVIEW FLOW (owner decision) — visible across every phase
            while walking through a multi-document batch, so the user
            always knows where they are without returning to the queue. */}
        {batchTotal > 0 && (
          <MutedText style={{ marginBottom: spacing.xs }}>
            {t('importJobs.batchReviewProgress', { position: batchPosition, total: batchTotal })}
          </MutedText>
        )}

        {phase === 'pick' && (
          <Card>
            <MutedText>{t('importScreen.pickPrompt')}</MutedText>
            <PrimaryButton title={t('importScreen.takePhoto')} onPress={() => router.push('/(tabs)/import/camera')} />
            <SecondaryButton title={t('importScreen.chooseFromGallery')} onPress={pickFromGallery} />
            <SecondaryButton title={t('importScreen.choosePdf')} onPress={pickPdf} />
            {/* FIRST-RUN TUTORIAL replay (owner decision 2026-08-05, FULL
                PARITY follow-up item I) — "See how" from the empty state. */}
            <Pressable onPress={() => router.push('/tutorial?replay=true' as Href)} hitSlop={8} style={{ marginTop: spacing.sm, alignSelf: 'center' }}>
              <Text style={{ color: colors.accent, fontWeight: '600', fontSize: typography.size.sm }}>
                {t('tutorial.seeHowLink')}
              </Text>
            </Pressable>
          </Card>
        )}

        {phase === 'working' && (
          <Card>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>{workingLabel}</Text>
          </Card>
        )}

        {phase === 'preview' && extraction && meta && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 28, marginEnd: spacing.sm }}>{meta.icon}</Text>
              <View>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg }}>{meta.label}</Text>
                <MutedText>{t('importScreen.goesTo', { route: meta.route })}</MutedText>
              </View>
            </View>

            {hasDuplicate && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.possibleDuplicateTitle')}</Text>
                {duplicates!.byContent.length > 0 && (
                  <MutedText>
                    {t('importScreen.duplicateByContent', {
                      label: meta?.label ?? t('docTypes.other.label'),
                      date: extraction.date,
                      amount: money(extraction.totalAmount, i18n.language),
                    })}
                  </MutedText>
                )}
                {duplicates!.byFilename.length > 0 && <MutedText>{t('importScreen.duplicateByFilename')}</MutedText>}
              </View>
            )}

            {extraction.docType === 'settlement' && existingSettlementWeek && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.settlementReplaceTitle')}</Text>
                <MutedText>
                  {t('importScreen.settlementReplaceBody', { date: settlementPrimaryDate ?? '' })}
                </MutedText>
              </View>
            )}

            {pagesProcessedNote && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.pagesProcessedTitle')}</Text>
                <MutedText>
                  {t('importScreen.pagesProcessedBody', {
                    covered: pagesProcessedNote.total - pagesProcessedNote.missingPages.length,
                    total: pagesProcessedNote.total,
                    missingPages: pagesProcessedNote.missingPages.join(', '),
                  })}
                </MutedText>
              </View>
            )}

            {!reconciliation.ok && (
              <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderColor: colors.red, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.red, fontWeight: '700' }}>{t('importScreen.reconciliationTitle')}</Text>
                {reconciliation.issues.map((issue, i) =>
                  issue.type === 'deductionsMismatch' ? (
                    <MutedText key={i}>
                      {t('importScreen.reconciliationDeductionsMismatch', {
                        stated: money(issue.stated, i18n.language),
                        summed: money(issue.summed, i18n.language),
                      })}
                    </MutedText>
                  ) : (
                    <MutedText key={i}>
                      {t('importScreen.reconciliationZeroNet', {
                        zero: money(0, i18n.language),
                        gross: money(issue.grossRevenue, i18n.language),
                      })}
                    </MutedText>
                  )
                )}
              </View>
            )}

            {extraction.confidence === 'low' && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.lowConfidenceTitle')}</Text>
                <MutedText>{t('importScreen.lowConfidenceBody')}</MutedText>
              </View>
            )}

            {extraction.docType === 'government_or_misc_income' && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.miscIncomeNoteTitle')}</Text>
                <MutedText>{t('importScreen.miscIncomeNoteBody')}</MutedText>
              </View>
            )}

            {(extraction.docType === 'store' || extraction.docType === 'amazon') && extraction.taxDeductible === false && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.mealsNoteTitle')}</Text>
                <MutedText>{t('importScreen.mealsNoteBody')}</MutedText>
              </View>
            )}

            {isOlderThanMonths(getPrimaryExtractionDate(extraction), 6) && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.dateConfirmTitle')}</Text>
                <MutedText>{t('importScreen.dateConfirmBody')}</MutedText>
              </View>
            )}

            <View style={{ marginBottom: spacing.sm }}>
              <Text style={{ color: extraction.docType === 'settlement' ? colors.orange : colors.muted, fontWeight: extraction.docType === 'settlement' ? '700' : '400' }}>
                {extraction.docType === 'settlement' ? t('importScreen.weekEndingLabel') : t('importScreen.documentDateLabel')}
              </Text>
              <Field
                value={getPrimaryExtractionDate(extraction)}
                onChangeText={(v) => setExtraction(withPrimaryExtractionDate(extraction, v))}
                placeholder="YYYY-MM-DD"
                style={{ marginBottom: spacing.xs }}
              />
              {settlementWeekEndingMissing && <ErrorText>{t('importScreen.weekEndingRequired')}</ErrorText>}
              {extraction.docType === 'settlement' && (
                <View style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}>
                  <MutedText>{t('importScreen.perDiemDaysLabel')}</MutedText>
                  <Field
                    keyboardType="numeric"
                    value={String(extraction.settlement?.perDiemDays ?? 0)}
                    onChangeText={(v) => setExtraction(withPerDiemDays(extraction, Number(v) || 0))}
                    placeholder="0-7"
                  />
                  <MutedText>{t('importScreen.perDiemDaysHint')}</MutedText>
                </View>
              )}
              <MutedText>{t('importScreen.vendorLabel', { vendor: extraction.vendor ?? '—' })}</MutedText>
              <MutedText>{t('importScreen.amountLabel', { amount: money(extraction.totalAmount, i18n.language) })}</MutedText>
              <MutedText>
                {t('importScreen.deductibleLabel', {
                  value: extraction.taxDeductible ? t('importScreen.deductibleYes') : t('importScreen.deductibleNo'),
                })}
              </MutedText>
              {extraction.summary ? <MutedText>{extraction.summary}</MutedText> : null}
            </View>

            {buildPreviewLines(extraction, t, i18n.language).map((line, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <MutedText>{line.label}</MutedText>
                <Text style={{ color: line.color ?? colors.text, fontWeight: '600' }}>{line.value}</Text>
              </View>
            ))}

            {(extraction.docType === 'amazon' || extraction.docType === 'store') && (
              <View style={{ marginTop: spacing.sm }}>
                <MutedText>{t('importScreen.previewLabels.paymentMethod')}</MutedText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
                  {PAYMENT_METHODS.map((pm) => (
                    <Pill
                      key={pm}
                      label={pm}
                      selected={normalizePaymentMethod(extraction.purchase?.paymentMethod) === pm}
                      onPress={() => setExtraction(withPaymentMethod(extraction, pm))}
                    />
                  ))}
                </View>
                {isPersonalPayment(normalizePaymentMethod(extraction.purchase?.paymentMethod)) && (
                  <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>
                    {t('deductions.personalPaymentNote')}
                  </MutedText>
                )}
              </View>
            )}

            {extraction.docType === 'other' && (
              <View style={{ marginTop: spacing.sm }}>
                <MutedText>{t('importScreen.previewLabels.suggestedCategory')}</MutedText>
                <View style={{ marginTop: spacing.xs }}>
                  <CategoryPicker kind="expense" value={categoryOverride} onChange={setCategoryOverride} />
                </View>
              </View>
            )}

            {needsTruckPicker && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('importScreen.whichTruck')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {trucks.map((truck) => (
                    <Pressable
                      key={truck.id}
                      onPress={() => {
                        setTruckId(truck.id);
                        setShowNewTruckForm(false);
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderColor: truckId === truck.id && !showNewTruckForm ? colors.accent : colors.border,
                        backgroundColor: truckId === truck.id && !showNewTruckForm ? colors.accent : colors.card2,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        {t('common.unit', { unit: truck.unit_number ?? truck.id })}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setShowNewTruckForm((v) => !v)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderColor: showNewTruckForm ? colors.accent : colors.border,
                      backgroundColor: showNewTruckForm ? colors.accent : colors.card2,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{t('importScreen.createNewTruck')}</Text>
                  </Pressable>
                </View>
                {showNewTruckForm && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Field
                      value={newTruckUnit}
                      onChangeText={setNewTruckUnit}
                      placeholder={t('importScreen.newTruckUnitPlaceholder')}
                    />
                    <PrimaryButton
                      title={t('common.create')}
                      onPress={handleCreateTruck}
                      loading={creatingTruck}
                      disabled={!newTruckUnit.trim()}
                    />
                  </View>
                )}
              </View>
            )}

            {needsDriverPicker && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('importScreen.whichDriver')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {drivers.map((driver) => (
                    <Pressable
                      key={driver.id}
                      onPress={() => {
                        setDriverId(driver.id);
                        setShowNewDriverForm(false);
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderColor: driverId === driver.id && !showNewDriverForm ? colors.accent : colors.border,
                        backgroundColor: driverId === driver.id && !showNewDriverForm ? colors.accent : colors.card2,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{driver.name}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setShowNewDriverForm((v) => !v)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderColor: showNewDriverForm ? colors.accent : colors.border,
                      backgroundColor: showNewDriverForm ? colors.accent : colors.card2,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{t('importScreen.createNewDriver')}</Text>
                  </Pressable>
                </View>
                {showNewDriverForm && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Field
                      value={newDriverName}
                      onChangeText={setNewDriverName}
                      placeholder={t('importScreen.newDriverNamePlaceholder')}
                    />
                    <PrimaryButton
                      title={t('common.create')}
                      onPress={handleCreateDriver}
                      loading={creatingDriver}
                      disabled={!newDriverName.trim()}
                    />
                  </View>
                )}
              </View>
            )}

            {showsDriverSplitInput && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('importScreen.driverShareLabel', { name: selectedDriver?.name ?? '' })}
                </Text>
                <Field
                  keyboardType="numeric"
                  value={driverShareAmount}
                  onChangeText={setDriverShareAmount}
                  placeholder={t('importScreen.driverSharePlaceholder')}
                />
              </View>
            )}

            <PrimaryButton
              title={hasDuplicate ? t('importScreen.saveAnyway') : t('importScreen.save')}
              onPress={handleSave}
              disabled={
                (needsTruckPicker && !truckId) ||
                (needsDriverPicker && !driverId) ||
                settlementWeekEndingMissing ||
                !reconciliation.ok
              }
            />
            {/* BATCH REVIEW FLOW — "Discard" doubles as "Skip" while
                walking a batch: nothing here saves without an explicit tap
                on Save above, per spec item 3; skipping just moves to the
                next queued document instead of resetting to 'pick'. */}
            <SecondaryButton
              title={batchTotal > 0 ? t('importJobs.skipDocument') : t('importScreen.discard')}
              onPress={batchTotal > 0 ? advanceBatchReview : reset}
            />
          </Card>
        )}

        {phase === 'saving' && (
          <Card>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>{t('importScreen.saving')}</Text>
          </Card>
        )}

        {phase === 'done' && result && extraction && (
          <Card>
            <Text style={{ color: colors.green, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.sm }}>
              {t('importScreen.saved')}
            </Text>
            {/* IMPORT SAVE BUG FIX (owner decision 2026-08-05) — a row
                that couldn't be saved even after the per-row fallback is
                never silently dropped; this names exactly which rows and
                why, right on the same screen that just said "Saved." */}
            {result.skippedRows.length > 0 && (
              <MutedText style={{ color: colors.orange }}>
                ⚠️ {t('importScreen.skippedRowsWarning', { count: result.skippedRows.length })}
                {'\n'}
                {result.skippedRows.map((r) => `• ${r.table}: ${r.description} — ${r.reason}`).join('\n')}
              </MutedText>
            )}
            {result.settlementWeekEnding && (
              <MutedText>
                {result.isSettlementReimport
                  ? t('importScreen.savedSettlementReplaced', { date: result.settlementWeekEnding })
                  : t('importScreen.savedSettlementNew', { date: result.settlementWeekEnding })}
              </MutedText>
            )}
            {result.netPayAdded != null && result.netPayAdded !== 0 && (
              // Re-import ordering / balance delta (owner decision
              // 2026-08-02): a corrected settlement can now REDUCE the
              // balance (negative delta) — money() already renders a
              // negative amount with its own "-" sign, so only a positive
              // delta gets an explicit "+" prefix here (never hardcoded
              // into the i18n string itself).
              <MutedText style={result.netPayAdded < 0 ? { color: colors.red } : undefined}>
                {t('importScreen.balanceAdded', {
                  amount: `${result.netPayAdded > 0 ? '+' : ''}${money(result.netPayAdded, i18n.language)}`,
                })}
              </MutedText>
            )}
            {result.contributionTotal > 0 && (
              <MutedText>
                {t('importScreen.contributionAdded', { amount: money(result.contributionTotal, i18n.language) })}
              </MutedText>
            )}
            {result.storagePath && <MutedText>{t('importScreen.savedToPath', { path: result.storagePath })}</MutedText>}
            {/* UX MEGA-PASS item D: three explicit choices instead of one
                "import another" — View Record reopens the just-saved
                document (with its own "linked records" jump to the
                actual settlement/deduction/etc. row), Done returns Home.
                BATCH REVIEW FLOW — in batch mode, Next/Finish takes over
                as the primary action (advances to the next queued
                document, or wraps up the batch and returns Home once
                every document has been confirmed — spec item 3, "Next...
                without returning to the queue between each"); View Record
                stays available as a secondary action either way. */}
            {batchTotal > 0 ? (
              <>
                <PrimaryButton
                  title={batchQueue.length > 0 ? t('importJobs.nextDocument') : t('importJobs.finishReview')}
                  onPress={advanceBatchReview}
                />
                <SecondaryButton
                  title={t('importScreen.viewRecord')}
                  onPress={() =>
                    router.push({ pathname: '/(tabs)/more/documents', params: { openId: result.documentId } } as unknown as Href)
                  }
                />
              </>
            ) : (
              <>
                <PrimaryButton
                  title={t('importScreen.viewRecord')}
                  onPress={() =>
                    router.push({ pathname: '/(tabs)/more/documents', params: { openId: result.documentId } } as unknown as Href)
                  }
                />
                <SecondaryButton title={t('importScreen.importAnother')} onPress={reset} />
                <SecondaryButton title={t('importScreen.done')} onPress={() => router.push('/(tabs)')} />
              </>
            )}
          </Card>
        )}

        {phase === 'error' && (
          <Card>
            {/* RICH IMPORT ERROR REPORTING (owner decision 2026-08-02,
                device feedback: "settlement imports failing frequently"):
                a headline naming WHICH step failed (grouped into a
                user-legible bucket — the exact granular step is always in
                the Copy Details report), a duplicate-settlement-race note
                when applicable, a partial-save note when some records may
                already exist, the raw underlying error message, and a
                Copy Details button carrying the full report (build info +
                exact step + error message/code/hint). */}
            {errorStepGroup && (
              <Text style={{ color: colors.orange, fontWeight: '700', fontSize: typography.size.md, marginBottom: spacing.xs }}>
                {t(`importScreen.errorSteps.${errorStepGroup}`)}
              </Text>
            )}
            {errorIsDuplicateRace && (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
                <MutedText>{t('importScreen.errorDuplicateRace')}</MutedText>
              </View>
            )}
            {!errorIsDuplicateRace && errorHasPartialSave && (
              <MutedText style={{ marginBottom: spacing.sm }}>{t('importScreen.errorPartialSaveNote')}</MutedText>
            )}
            <ErrorText>{errorMessage}</ErrorText>
            {errorReport && (
              <SecondaryButton title={copied ? copiedLabel : copyLabel} onPress={handleCopyDetails} />
            )}
            {/* COST CONTROL & GRACEFUL DEGRADATION (owner decision
                2026-08-24, FIVE ADDITIONS pass, PART 4 item 4) — the
                already-picked file is still right here; one tap retries
                it directly, no re-picking required. A genuinely different
                file still needs the full reset. */}
            {/* BATCH REVIEW FLOW — "a failed item never blocks the
                others" (spec item 5): Skip is always offered in batch
                mode so one bad document can't stall the rest of the
                walkthrough, on top of whatever recovery options this
                specific failure already offers. */}
            {batchTotal > 0 && <PrimaryButton title={t('importJobs.skipDocument')} onPress={advanceBatchReview} />}
            {fileMeta ? (
              <>
                <PrimaryButton title={`🔁 ${t('importScreen.retryImport')}`} onPress={handleRetryImport} />
                <SecondaryButton title={t('importScreen.chooseDifferentFile')} onPress={reset} />
              </>
            ) : (
              <SecondaryButton title={t('importScreen.tryAgain')} onPress={reset} />
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
