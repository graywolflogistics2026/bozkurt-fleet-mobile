import { ScrollView, Text } from 'react-native';
import { PRIVACY_TITLE, PRIVACY_BODY } from '@/src/config/privacyPolicy';
import { Screen, ScreenTitle } from '@/src/components/ui';
import { colors, typography } from '@/src/theme';

// Settings > Legal (PROMPTS.md Session 10, owner decision 2026-07-04,
// D12 pairs this with Terms of Use) — never re-translated (CLAUDE.md
// invariant #11: legal documents stay English-only until attorney review).
export default function PrivacyPolicyScreen() {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{PRIVACY_TITLE}</ScreenTitle>
        <Text style={{ color: colors.text, fontSize: typography.size.sm, lineHeight: 20 }}>{PRIVACY_BODY}</Text>
      </ScrollView>
    </Screen>
  );
}
