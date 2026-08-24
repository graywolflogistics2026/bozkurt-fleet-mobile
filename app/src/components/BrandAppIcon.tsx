import { View } from 'react-native';
import { BrandLogo, BRAND_LOGO_LIGHT } from '@/src/components/BrandLogo';
import { colors } from '@/src/theme';

// SQUARE APP-ICON COMPOSITION (owner decision 2026-08-24, branding pass,
// item A2's "export a square app-icon composition ... ready for Session
// 10's store assets"): dark background + centered white truck mark, at
// any `size`. This is a source COMPONENT, not a generated PNG — turning
// it into the actual store icon files (app.config.js's `icon`/
// `android.adaptiveIcon.*`/`web.favicon`) still needs a render-to-PNG
// step this code-only pass can't perform (an SVG-to-raster export, done
// once when Session 10's real store assets are produced — see CLAUDE.md's
// branding-pass entry). Composed from plain View layout (not nested SVG
// viewports) so it reuses BrandLogo exactly as every other screen already
// does — one truck-mark definition, never a second copy of its path data.
export function BrandAppIcon({ size = 512 }: { size?: number }) {
  const truckSize = size * 0.62; // leaves a comfortable margin, matches standard app-icon "safe zone" conventions
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.18,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <BrandLogo size={truckSize} color={BRAND_LOGO_LIGHT} />
    </View>
  );
}
