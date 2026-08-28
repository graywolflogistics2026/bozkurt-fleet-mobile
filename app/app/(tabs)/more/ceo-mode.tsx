import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '@/src/data/documents';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useAiCoachSummary } from '@/src/data/aiCoachSummary';
import { trailingAverageNet } from '@/src/stats/goalProgress';
import { RECOMMENDATION_ICON, recommendationText, recommendationRoute } from '@/src/stats/aiRecommendations';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, TappableCard, MutedText, LegalFootnote, Field, PrimaryButton, ErrorText } from '@/src/components/ui';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { BrandWordmark } from '@/src/components/BrandWordmark';
import { ShareCardModal } from '@/src/components/shareCard/ShareCardModal';
import { colors, radii, spacing, typography } from '@/src/theme';
import { BRAND_NAME } from '@/src/brand';
import i18n from '@/src/i18n';

// CEO Mode — Daily/Weekly Briefing v1 (PROMPTS.md Session 9b item 10,
// CLAUDE.md invariant #22 — composed ONLY from this account's own data,
// no live external feeds). Follows the exact same pattern Profit
// Analysis (Session 9a) already established: build a rich, data-filled
// prompt client-side, send it as one 'user' message to the generic
// ai-advisor Edge Function (no server-side changes needed), render the
// reply with the standard disclaimer footer.
export default function CeoMode() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const moneyRounded = (n: number) => money(n, { maximumFractionDigits: 0 });
  const router = useRouter();
  const documentsQuery = useDocuments();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  // AI COACH FULLY VISIBLE ON HOME (owner decision 2026-08-24) — the
  // recommendation/needs-review/maintenance/compliance derivation moved
  // into src/data/aiCoachSummary.ts's useAiCoachSummary(), the ONE shared
  // hook this screen and Home (app/(tabs)/index.tsx) both read from now.
  const coach = useAiCoachSummary();

  const [goalInput, setGoalInput] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // REMOVE AI ADVISOR AS A SEPARATE SCREEN (owner decision, SIMPLIFICATION
  // PASS) — the deleted ai-advisor.tsx offered ONE real capability AI
  // Coach didn't already have: a genuine multi-turn, free-form Q&A chat
  // against callAiAdvisor() (this screen's own handleGetBriefing() only
  // ever sent ONE composed message and never kept a running history).
  // Folded in here, verbatim in spirit — same ChatMessage shape, same
  // "forward the full running history on every send so the model can
  // follow up on earlier turns" behavior — before the dedicated screen
  // was removed.
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const loadingData = coach.isLoading || documentsQuery.isLoading || profileQuery.isLoading;
  const latestWeek = coach.latestWeek;

  const weeklyGoal = profileQuery.data?.weekly_goal ?? null;
  const goalProgressPct = weeklyGoal && weeklyGoal > 0 && latestWeek ? (latestWeek.net / weeklyGoal) * 100 : null;
  // WEEKLY GOAL DRIVES THE COACH (owner decision 2026-08-24, FIVE
  // ADDITIONS pass, PART 3 item 4) — "prefilled from the trailing 4-week
  // average net," the SAME real number the Alerts screen's "set a weekly
  // goal" unlock nudge names (src/stats/goalProgress.ts's
  // trailingAverageNet(), one shared function so the two never suggest
  // different starting points). Only used to PREFILL the field before the
  // user has ever set a goal — once a real weekly_goal exists, the field
  // always reflects that saved value, never silently reverts to a moving
  // average.
  const suggestedGoal = useMemo(() => trailingAverageNet(coach.weeklyTrend), [coach.weeklyTrend]);

  // Prefill ONLY the first-open goal field (weeklyGoal still null) and
  // ONLY while the user hasn't typed anything of their own yet — never
  // overwrites an in-progress edit, and never touches the field once a
  // real weekly_goal is already saved.
  useEffect(() => {
    if (weeklyGoal == null && goalInput === '' && suggestedGoal != null && suggestedGoal > 0) {
      setGoalInput(String(Math.round(suggestedGoal)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeklyGoal, suggestedGoal]);

  // Tax opportunity hint: archived documents that never resolved past the
  // generic 'other' docType (CLAUDE.md invariant #14) — the same
  // population needs-review deductions come from, but this also counts
  // documents that were archived without becoming a deduction at all.
  const unresolvedOtherDocs = useMemo(() => (documentsQuery.data ?? []).filter((d) => d.doc_type === 'other').length, [documentsQuery.data]);

  async function handleSaveGoal() {
    const value = Number(goalInput);
    if (!value || value <= 0) return;
    setGoalSaving(true);
    try {
      await updateProfile.mutateAsync({ weekly_goal: value });
    } catch (err) {
      Alert.alert(t('ceoMode.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setGoalSaving(false);
    }
  }

  async function handleGetBriefing() {
    setLoading(true);
    setError(null);
    setBriefing(null);
    try {
      const parts = [
        'Give me my weekly business briefing as a friendly, encouraging CEO coach would.',
        latestWeek ? `This week's revenue: ${money(latestWeek.gross)}, profit: ${money(latestWeek.net)}.` : 'No settlements recorded yet this week.',
        goalProgressPct != null ? `Weekly profit goal: ${money(weeklyGoal ?? 0)} — currently at ${goalProgressPct.toFixed(0)}% of goal.` : '',
        coach.needsReviewCount > 0
          ? `${coach.needsReviewCount} receipt(s) flagged NEEDS REVIEW and waiting on a decision.`
          : 'No receipts waiting on review.',
        coach.maintenanceAlertCount > 0
          ? `${coach.maintenanceAlertCount} maintenance item(s) due soon or overdue on the active truck.`
          : 'No maintenance items due soon.',
        coach.complianceDueSoonCount > 0
          ? `${coach.complianceDueSoonCount} compliance item(s) (DOT/IRP/insurance/etc.) due soon or overdue.`
          : 'No compliance items due soon.',
        unresolvedOtherDocs > 0 ? `${unresolvedOtherDocs} imported document(s) never got sorted into a real category — possible missed deductions.` : '',
        'Give 2-4 short, specific, encouraging observations and next actions. Keep it upbeat but honest.',
      ].filter(Boolean);
      const result = await callAiAdvisor([{ role: 'user', content: parts.join(' ') }], i18n.language);
      if (result.error) {
        setError(result.error.message || t('ceoMode.briefingFailed'));
      } else {
        setBriefing(result.data ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ceoMode.briefingFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSendChat() {
    const question = chatInput.trim();
    if (!question || chatSending) return;
    setChatError(null);
    const nextMessages: { role: 'user' | 'assistant'; content: string }[] = [...chatMessages, { role: 'user', content: question }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatSending(true);
    try {
      const result = await callAiAdvisor(nextMessages, i18n.language);
      if (result.error) {
        setChatError(result.error.message || t('ceoMode.chatFailedTitle'));
      } else if (result.data) {
        setChatMessages((prev) => [...prev, { role: 'assistant', content: result.data as string }]);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : t('ceoMode.chatFailedTitle'));
    } finally {
      setChatSending(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* BRAND REFRESH (owner decision 2026-07-30): AI Coach is the one
            screen the "Your AI Business Coach" tagline is most directly
            about — the logo+name+tagline header block appears here too,
            not just the app-wide top bar/sidebar. */}
        <View style={{ marginBottom: spacing.md }}>
          <BrandWordmark fontSize={16} showTagline />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <ScreenTitle>{t('ceoMode.title')}</ScreenTitle>
            {/* SELF-TEST AUDIT (owner decision, MULTI-TRUCK MODEL) — see
                AiCoachSection's own identical comment on Home: this
                screen's whole briefing (weekly review, recommendations,
                goal tracking) is composed from account-wide data by
                design, never re-derived per truck. */}
            <FleetScopeLabel variant="fleetOnly" />
            <MutedText>{t('ceoMode.subtitle')}</MutedText>
          </View>
          {!loadingData && (
            <Pressable onPress={() => setShareOpen(true)} hitSlop={8} style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
                📤 {t('shareProfit.share')}
              </Text>
            </Pressable>
          )}
        </View>

        {loadingData ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            {coach.recommendations.length > 0 && (
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.xs }}>
                  {coach.recommendationsTotalImpact > 0
                    ? t('ceoMode.recommendations.headerTitle', { amount: moneyRounded(coach.recommendationsTotalImpact) })
                    : t('ceoMode.recommendations.headerTitleZero')}
                </Text>
                <MutedText style={{ marginBottom: spacing.sm }}>{t('ceoMode.recommendations.subtitle')}</MutedText>
                {coach.recommendations.map((rec) => (
                  <TappableCard key={rec.type} onPress={() => router.push(recommendationRoute(rec))}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Text style={{ fontSize: 20 }}>{RECOMMENDATION_ICON[rec.type]}</Text>
                      <Text style={{ color: colors.text, flex: 1 }}>{recommendationText(rec, t, moneyRounded)}</Text>
                    </View>
                  </TappableCard>
                ))}
              </Card>
            )}

            <Card>
              <View style={styles.statRow}>
                <View style={styles.statCell}>
                  <MutedText>{t('ceoMode.thisWeekRevenue')}</MutedText>
                  <Text style={[styles.statValue, { color: colors.green }]}>{latestWeek ? money(latestWeek.gross) : '—'}</Text>
                </View>
                <View style={styles.statCell}>
                  <MutedText>{t('ceoMode.thisWeekProfit')}</MutedText>
                  <Text style={[styles.statValue, { color: colors.green }]}>{latestWeek ? money(latestWeek.net) : '—'}</Text>
                </View>
              </View>
            </Card>

            {weeklyGoal == null ? (
              // First-open goal prompt (device feedback round 2, owner
              // decision 2026-07-13): a null weekly_goal blocks the
              // briefing itself, not just its progress-% line — friendlier,
              // more prominent copy than the old inline "no goal set" note,
              // and the briefing section below doesn't render at all until
              // a goal is saved.
              <>
                <Text style={styles.sectionTitle}>{t('ceoMode.goalPromptTitle')}</Text>
                <Card>
                  <MutedText>{t('ceoMode.goalPromptBody')}</MutedText>
                  <Field
                    keyboardType="numeric"
                    value={goalInput}
                    onChangeText={setGoalInput}
                    placeholder={t('ceoMode.goalPlaceholder')}
                    style={{ marginTop: spacing.sm }}
                  />
                  <PrimaryButton title={t('ceoMode.saveGoal')} onPress={handleSaveGoal} loading={goalSaving} disabled={!goalInput} />
                </Card>
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>{t('ceoMode.weeklyGoalTitle')}</Text>
                <Card>
                  <MutedText>{t('ceoMode.currentGoal', { amount: money(weeklyGoal) })}</MutedText>
                  {goalProgressPct != null && (
                    <Text style={{ color: goalProgressPct >= 100 ? colors.green : colors.text, fontWeight: '700', fontSize: typography.size.lg, marginTop: 2 }}>
                      {goalProgressPct.toFixed(0)}% {t('ceoMode.ofGoal')}
                    </Text>
                  )}
                  <Field keyboardType="numeric" value={goalInput} onChangeText={setGoalInput} placeholder={t('ceoMode.goalPlaceholder')} />
                  <PrimaryButton title={t('ceoMode.saveGoal')} onPress={handleSaveGoal} loading={goalSaving} disabled={!goalInput} />
                </Card>

                <Text style={styles.sectionTitle}>{t('ceoMode.statusTitle')}</Text>
                <Card>
                  <View style={styles.row}>
                    <MutedText>{t('ceoMode.needsReview')}</MutedText>
                    <Text style={{ color: coach.needsReviewCount > 0 ? colors.orange : colors.text, fontWeight: '700' }}>
                      {number(coach.needsReviewCount)}
                    </Text>
                  </View>
                  <View style={[styles.row, styles.rowBorder]}>
                    <MutedText>{t('ceoMode.maintenanceDue')}</MutedText>
                    <Text style={{ color: coach.maintenanceAlertCount > 0 ? colors.orange : colors.text, fontWeight: '700' }}>
                      {number(coach.maintenanceAlertCount)}
                    </Text>
                  </View>
                  <View style={[styles.row, styles.rowBorder]}>
                    <MutedText>{t('ceoMode.complianceDue')}</MutedText>
                    <Text style={{ color: coach.complianceDueSoonCount > 0 ? colors.orange : colors.text, fontWeight: '700' }}>
                      {number(coach.complianceDueSoonCount)}
                    </Text>
                  </View>
                </Card>

                <Text style={styles.sectionTitle}>{t('ceoMode.briefingTitle')}</Text>
                <Card>
                  <PrimaryButton title={`🐺 ${t('ceoMode.getBriefing')}`} onPress={handleGetBriefing} loading={loading} />
                  {briefing && (
                    <>
                      <Text style={{ color: colors.text, marginTop: spacing.sm, lineHeight: 20 }}>{briefing}</Text>
                      <MutedText style={{ marginTop: spacing.xs }}>{t('profitAnalysis.aiFooter')}</MutedText>
                    </>
                  )}
                  {error && <MutedText style={{ color: colors.red, marginTop: spacing.sm }}>{error}</MutedText>}
                </Card>

                {/* ASK A QUESTION — folded in from the removed ai-advisor.tsx
                    (owner decision, SIMPLIFICATION PASS): the one capability
                    that screen had and AI Coach didn't — a genuine, multi-
                    turn free-form chat, not just a one-shot briefing. */}
                <Text style={styles.sectionTitle}>{t('ceoMode.chatTitle')}</Text>
                <Card>
                  {chatMessages.length === 0 ? (
                    <MutedText>{t('ceoMode.chatEmpty')}</MutedText>
                  ) : (
                    chatMessages.map((m, i) => (
                      <View key={i} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}>
                        <View
                          style={{
                            maxWidth: '85%',
                            backgroundColor: m.role === 'user' ? colors.accent : colors.card2,
                            borderColor: colors.border,
                            borderWidth: m.role === 'user' ? 0 : 1,
                            borderRadius: radii.md,
                            padding: spacing.sm,
                          }}
                        >
                          <Text style={{ color: colors.text, fontSize: typography.size.md, lineHeight: 20 }}>{m.content}</Text>
                        </View>
                      </View>
                    ))
                  )}
                  <ErrorText>{chatError}</ErrorText>
                  <Field
                    value={chatInput}
                    onChangeText={setChatInput}
                    placeholder={t('ceoMode.chatInputPlaceholder')}
                    onSubmitEditing={handleSendChat}
                  />
                  <PrimaryButton title={t('ceoMode.chatSend')} onPress={handleSendChat} loading={chatSending} disabled={!chatInput.trim()} />
                  <MutedText style={{ marginTop: spacing.xs }}>{t('profitAnalysis.aiFooter')}</MutedText>
                </Card>
              </>
            )}
            <LegalFootnote />
          </>
        )}
      </ScrollView>

      {!loadingData && (
        <ShareCardModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          title={t('ceoMode.title')}
          caption={t('shareProfit.captionTemplate', { weekSummary: t('ceoMode.title'), brand: BRAND_NAME })}
          renderCard={() => (
            <View style={shareStyles.shareCard}>
              {profileQuery.data?.company_name?.trim() && (
                <Text style={shareStyles.shareCompanyName}>{profileQuery.data.company_name.trim()}</Text>
              )}
              <Text style={shareStyles.shareCardTitle}>{t('ceoMode.title')}</Text>
              <View style={shareStyles.shareKpiRow}>
                <View style={{ alignItems: 'center' }}>
                  <MutedText>{t('ceoMode.thisWeekRevenue')}</MutedText>
                  <Text style={{ color: colors.green, fontWeight: '700' }}>{latestWeek ? money(latestWeek.gross) : '—'}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <MutedText>{t('ceoMode.thisWeekProfit')}</MutedText>
                  <Text style={{ color: colors.green, fontWeight: '700' }}>{latestWeek ? money(latestWeek.net) : '—'}</Text>
                </View>
              </View>
              <View style={shareStyles.shareBrandFooter}>
                <BrandWordmark fontSize={16} />
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const shareStyles = {
  shareCard: {
    width: 320,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: 'center' as const,
  },
  shareCompanyName: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginBottom: spacing.xs,
  },
  shareCardTitle: {
    color: colors.muted,
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
  },
  shareKpiRow: {
    flexDirection: 'row' as const,
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  shareBrandFooter: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    width: '100%' as const,
    alignItems: 'center' as const,
  },
};

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  statRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
  },
  statValue: {
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
    marginTop: 2,
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
};
