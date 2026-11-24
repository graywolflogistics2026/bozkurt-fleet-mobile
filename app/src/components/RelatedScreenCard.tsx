// RELATED SCREEN CARD (owner decisions 2026-11-23, docs/decisions/
// menu-simplification-proposal.md, Stage 2). A screen that left the Menu
// is opened from a card on its parent screen. The card only NAVIGATES:
// router.push to the child's own, unchanged route, so the back button
// returns to the parent. It never runs an action and never hides or
// changes the parent's content. Same look as every other tappable card
// (TappableCard: card + chevron).
//
// The caller passes the child's route as a string literal, so
// src/navigation/__tests__/menuReachability.test.ts can verify that the
// parent screen file really links to it.
import { Text } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { MutedText, TappableCard } from '@/src/components/ui';
import { colors, typography } from '@/src/theme';

export function RelatedScreenCard({
  href,
  emoji,
  title,
  description,
}: {
  href: string;
  emoji: string;
  title: string;
  description: string;
}) {
  const router = useRouter();
  return (
    <TappableCard onPress={() => router.push(href as Href)}>
      <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '700' }}>
        {emoji} {title}
      </Text>
      <MutedText>{description}</MutedText>
    </TappableCard>
  );
}
