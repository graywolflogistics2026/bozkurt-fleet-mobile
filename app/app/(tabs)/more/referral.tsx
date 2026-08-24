import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMyReferralCode, useMyReferrals, useMyAccountCredits, useReferralSyncOnce, type ReferralRow } from '@/src/data/referral';
import { computeReferralProgress } from '@/src/referral/reward';
import { buildReferralShareMessage } from '@/src/referral/shareMessage';
import { shareViaSystemSheet, shareViaWhatsApp, shareViaSms, copyReferralMessage } from '@/src/referral/referralShare';
import { buildAuthRedirectUrl } from '@/src/auth/deepLinkRedirect';
import { Screen, ScreenTitle, Card, MutedText, SecondaryButton, LegalFootnote } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

const STATUS_COLOR: Record<ReferralRow['status'], string> = {
  pending: colors.muted,
  qualified: colors.orange,
  rewarded: colors.green,
};

// REFERRAL PROGRAM (owner decision 2026-08-24, item R3) — Menu → Tools →
// "Invite & earn". Every figure here (progress, credit total, invite
// list) reads straight from the DB (src/data/referral.ts) — nothing is
// computed optimistically client-side, since only handle_new_user()/the
// referral-sync Edge Function are ever allowed to actually change
// referrals/account_credits (docs/PENDING_SQL.md §50's RLS: SELECT-only
// for regular users).
export default function Referral() {
  const { t } = useTranslation();
  const code = useMyReferralCode();
  const referralsQuery = useMyReferrals();
  const creditsQuery = useMyAccountCredits();
  useReferralSyncOnce();
  const [sharing, setSharing] = useState(false);

  const referrals = referralsQuery.data ?? [];
  const rewardEligibleCount = referrals.filter((r) => r.status === 'qualified' || r.status === 'rewarded').length;
  const progress = computeReferralProgress(rewardEligibleCount);
  const totalCreditDays = (creditsQuery.data ?? []).reduce((sum, c) => sum + c.days, 0);

  async function handleShare(destination: 'system' | 'whatsapp' | 'sms' | 'copy') {
    if (!code) return;
    setSharing(true);
    try {
      const message = buildReferralShareMessage({
        code,
        body: t('referral.shareBody'),
        // "(auth)" is a route GROUP (app/(auth)/sign-up.tsx) — expo-router
        // groups never appear in the actual URL, only the file structure,
        // so the deep link path is plain "sign-up".
        deepLink: `${buildAuthRedirectUrl('sign-up')}?ref=${encodeURIComponent(code)}`,
      });
      if (destination === 'system') await shareViaSystemSheet(message);
      else if (destination === 'whatsapp') await shareViaWhatsApp(message);
      else if (destination === 'sms') await shareViaSms(message);
      else await copyReferralMessage(message);
    } finally {
      setSharing(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('referral.title')}</ScreenTitle>
        <MutedText>{t('referral.subtitle')}</MutedText>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.xs }}>
          {t('referral.progress', { qualified: progress.inCurrentCycle, remaining: progress.remaining })}
        </Text>
        <MutedText>{t('referral.progressSubtitle')}</MutedText>
      </Card>

      <Card>
        <MutedText>{t('referral.yourCode')}</MutedText>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 28, letterSpacing: 2, marginVertical: spacing.sm }}>
          {code ?? '—'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <SecondaryButton title={`📤 ${t('referral.shareGeneric')}`} onPress={() => handleShare('system')} loading={sharing} disabled={!code} />
          <SecondaryButton title="WhatsApp" onPress={() => handleShare('whatsapp')} loading={sharing} disabled={!code} />
          <SecondaryButton title={t('referral.shareSms')} onPress={() => handleShare('sms')} loading={sharing} disabled={!code} />
          <SecondaryButton title={t('referral.copyLink')} onPress={() => handleShare('copy')} loading={sharing} disabled={!code} />
        </View>
      </Card>

      <Text style={styles.sectionTitle}>{t('referral.invitesTitle')}</Text>
      {referrals.length === 0 ? (
        <Card>
          <MutedText>{t('referral.noInvitesYet')}</MutedText>
        </Card>
      ) : (
        referrals.map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {r.referred_label ?? t('referral.pendingLabel')}
              </Text>
              <Text style={{ color: STATUS_COLOR[r.status], fontWeight: '700', fontSize: typography.size.sm }}>
                {t(`referral.status.${r.status}`)}
              </Text>
            </View>
          </Card>
        ))
      )}
      <MutedText style={{ marginBottom: spacing.md }}>{t('referral.qualifiedExplainer')}</MutedText>

      <Text style={styles.sectionTitle}>{t('referral.creditsTitle')}</Text>
      <Card>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg }}>
          {t('referral.creditDays', { count: totalCreditDays })}
        </Text>
        <MutedText style={{ marginTop: spacing.xs }}>{t('referral.creditAppliesNote')}</MutedText>
      </Card>

        <LegalFootnote>{t('referral.tnc')}</LegalFootnote>
      </ScrollView>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.muted,
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
};
