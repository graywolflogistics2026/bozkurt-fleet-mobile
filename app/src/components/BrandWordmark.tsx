import { Text, View } from 'react-native';
import { colors } from '@/src/theme';
import { BRAND_NAME, BRAND_EMOJI } from '@/src/brand';

// Placeholder wordmark (emoji + text) until a real logo asset exists —
// every screen showing the brand renders this instead of its own
// hardcoded string, so a future logo swap touches one component.
export function BrandWordmark({ fontSize = 18 }: { fontSize?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontSize: fontSize + 4, marginEnd: 6 }}>{BRAND_EMOJI}</Text>
      <Text style={{ color: colors.text, fontSize, fontWeight: '800', letterSpacing: 0.3 }}>{BRAND_NAME}</Text>
    </View>
  );
}
