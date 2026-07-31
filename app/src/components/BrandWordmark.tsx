import { Text, View } from 'react-native';
import { colors, spacing } from '@/src/theme';
import { BRAND_NAME, BRAND_TAGLINE } from '@/src/brand';
import { BrandLogo } from '@/src/components/BrandLogo';

// BRAND REFRESH (owner decision 2026-07-30): logo + wordmark, optionally
// with the tagline underneath — the one "header block" every surface
// (phone top bar, wide-screen sidebar, share-card footer) renders so a
// future brand change (name, tagline, or the logo mark itself) only ever
// touches this component + brand.ts, never a screen.
export function BrandWordmark({
  fontSize = 18,
  showTagline = false,
  logoSize,
}: {
  fontSize?: number;
  showTagline?: boolean;
  logoSize?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <BrandLogo size={logoSize ?? fontSize + 10} />
      <View style={{ marginStart: spacing.xs }}>
        <Text style={{ color: colors.text, fontSize, fontWeight: '800', letterSpacing: 0.3 }} numberOfLines={1}>
          {BRAND_NAME}
        </Text>
        {showTagline && (
          <Text style={{ color: colors.muted, fontSize: Math.max(10, fontSize - 8), fontWeight: '600' }} numberOfLines={1}>
            {BRAND_TAGLINE}
          </Text>
        )}
      </View>
    </View>
  );
}
