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
  companyName,
}: {
  fontSize?: number;
  showTagline?: boolean;
  logoSize?: number;
  // BETA FEEDBACK ROUND (owner decision 2026-07-31): "company name under
  // the wordmark where the tagline is, when a company name exists." Only
  // the call site that passes this (the Dashboard top bar) ever shows a
  // company name here — every other BrandWordmark usage (CEO Mode's own
  // in-page header block, share-card footers, the wide sidebar) keeps
  // showing the actual tagline unchanged, since this prop is opt-in per
  // call site, not a global behavior change.
  companyName?: string | null;
}) {
  const subtitle = companyName?.trim() || BRAND_TAGLINE;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <BrandLogo size={logoSize ?? fontSize + 10} />
      <View style={{ marginStart: spacing.xs }}>
        <Text style={{ color: colors.text, fontSize, fontWeight: '800', letterSpacing: 0.3 }} numberOfLines={1}>
          {BRAND_NAME}
        </Text>
        {showTagline && (
          <Text style={{ color: colors.muted, fontSize: Math.max(10, fontSize - 8), fontWeight: '600' }} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}
