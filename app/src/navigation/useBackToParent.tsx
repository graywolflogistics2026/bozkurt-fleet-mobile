import { useCallback, useLayoutEffect } from 'react';
import { BackHandler, Pressable, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import { colors, spacing } from '@/src/theme';

// BACK TO THE CARD'S PARENT (owner 2026-11-24). A screen opened from a card
// on another tab's screen gets ?from=<key>: its hardware back button and a
// header arrow then return to that parent instead of the default (Home for
// a hidden tab route, the More stack for a More screen). The param is
// cleared when the screen loses focus, so any later open without it keeps
// today's back behaviour unchanged.
//   - Transactions, from the Operating P&L card (from=operating-pnl)
//   - Maintenance, from the Truck Health card (from=truck-health)
export const BACK_TARGETS: Record<string, string> = {
  'operating-pnl': '/(tabs)/more/operating-pnl',
  'truck-health': '/(tabs)/truck-health',
};

export function useBackToParent() {
  const router = useRouter();
  const navigation = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const target = from ? BACK_TARGETS[from] : undefined;

  const goBack = useCallback(() => {
    if (target) router.navigate(target as Href);
  }, [router, target]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: target
        ? () => (
            <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" style={{ paddingHorizontal: spacing.md }}>
              <Text style={{ fontSize: 22, color: colors.text }}>←</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, target, goBack]);

  useFocusEffect(
    useCallback(() => {
      if (!target) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack();
        return true;
      });
      return () => {
        sub.remove();
        navigation.setParams({ from: undefined } as never);
      };
    }, [target, goBack, navigation])
  );
}
