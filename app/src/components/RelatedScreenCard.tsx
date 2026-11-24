// RELATED SCREEN CARD (owner decisions 2026-11-23, docs/decisions/
// menu-simplification-proposal.md, Stage 2). A screen that left the Menu
// is opened from a card on its parent screen. The card only NAVIGATES:
// router.push to the child's own, unchanged route, so the back button
// returns to the parent. It never runs an action and never hides or
// changes the parent's content. Same look as every other tappable card
// (TappableCard: card + chevron).
//
// `params` (optional) are passed to the child route, e.g. so a hidden
// tab screen (Transactions) knows which parent to go back to.
//
// The caller passes the child's route as a string literal, so
// src/navigation/__tests__/menuReachability.test.ts can verify that the
// parent screen file really links to it.
import { I18nManager, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { MutedText, TappableCard } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

export function RelatedScreenCard({
  href,
  emoji,
  title,
  description,
  params,
}: {
  href: string;
  emoji: string;
  title: string;
  description: string;
  params?: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <TappableCard onPress={() => router.push((params ? { pathname: href, params } : href) as Href)}>
      <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '700' }}>
        {emoji} {title}
      </Text>
      <MutedText>{description}</MutedText>
    </TappableCard>
  );
}

// FEATURED variant (owner 2026-11-24): one card a specific group of users
// must notice at once (For Prime Inc Drivers on Accountant Package). About
// twice the height of a normal card, bigger bold title, a badge, accent
// border on an accent-tinted background (dark theme), and an "Open"
// affordance. Same navigation as RelatedScreenCard: router.push only.
// Text is never truncated (no numberOfLines).
export function FeaturedScreenCard({
  href,
  emoji,
  title,
  description,
  badge,
  openLabel,
}: {
  href: string;
  emoji: string;
  title: string;
  description: string;
  badge: string;
  openLabel: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(href as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      style={({ pressed }) => ({
        minHeight: 140,
        borderWidth: 2,
        borderColor: colors.accent,
        backgroundColor: ACCENT_TINT,
        borderRadius: radii.lg,
        padding: spacing.lg,
        marginBottom: spacing.md,
        justifyContent: 'space-between',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
        <View style={{ backgroundColor: colors.accent, borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
          <Text style={{ color: '#ffffff', fontSize: typography.size.xs, fontWeight: '700' }}>{badge}</Text>
        </View>
      </View>
      <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '800', marginBottom: spacing.xs }}>
        {emoji} {title}
      </Text>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>{description}</Text>
      <Text style={{ color: colors.accent, fontSize: typography.size.lg, fontWeight: '700', marginTop: spacing.sm, alignSelf: 'flex-end' }}>
        {openLabel} {I18nManager.isRTL ? '←' : '→'}
      </Text>
    </Pressable>
  );
}

// colors.accent (#2563eb) at 16% over the dark card colour.
const ACCENT_TINT = 'rgba(37, 99, 235, 0.16)';
