import { ScrollView, Text } from 'react-native';
import { TOS_TITLE, TOS_BODY } from '@/src/config/termsOfUse';
import { Screen, ScreenTitle } from '@/src/components/ui';
import { colors, typography } from '@/src/theme';

// Settings > Legal read-only re-display (PROMPTS.md Session 10, owner
// decision 2026-07-04, D12) — same content shown/accepted at first launch
// (app/tos.tsx), never re-translated (CLAUDE.md invariant #11: legal
// documents stay English-only until attorney review).
export default function TermsOfUseScreen() {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{TOS_TITLE}</ScreenTitle>
        <Text style={{ color: colors.text, fontSize: typography.size.sm, lineHeight: 20 }}>{TOS_BODY}</Text>
      </ScrollView>
    </Screen>
  );
}
