#!/usr/bin/env node
// generateBrandAssets.js — APP ICON + SPLASH (owner decision 2026-08-27):
// renders the app's real brand mark (the same truck-silhouette glyph
// app/src/components/BrandLogo.tsx draws in-app, composed the same way
// app/src/components/BrandAppIcon.tsx composes it for a square icon) into
// the actual PNG files app.config.js and store-assets/ need — replacing
// the default Expo template placeholders that shipped until now.
//
// WHY THIS IS A STANDALONE SCRIPT, NOT A REACT NATIVE RENDER: there is no
// way to rasterize a live RN <Svg> component to a PNG file outside of an
// actual app instance (no headless RN renderer in this toolchain). Instead
// this script re-expresses BrandLogo.tsx's exact SVG path/rect/circle
// data (viewBox "0 0 48 26", the same 5 shapes: trailer rect, sleeper-cab
// path, chassis line, two wheel circles) as plain SVG strings and rasterizes
// them with `sharp` (a devDependency added specifically for this script —
// not used anywhere in the app's own runtime code). If BrandLogo.tsx's
// path data ever changes, update TRUCK_MARK_INNER_SVG below to match —
// there is deliberately only ONE copy of this path data to keep in sync,
// same "one truck-mark definition, never a second copy" rule
// BrandAppIcon.tsx's own header comment already states for the in-app case.
//
// USAGE (regenerate at any time — e.g. after a design tweak):
//   node scripts/generateBrandAssets.js
// Requires `sharp` (already in devDependencies — run `npm install` first
// if it's missing). Writes directly into assets/images/ (app icon/splash/
// favicon/Android files app.config.js references) and ../store-assets/
// (Play Store icon + feature graphic, App Store icon) at the repo root.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ---- Design tokens, copied from the single source of truth ----------
// app/src/theme.ts's colors.bg (the app's darkest surface, dark-theme-only
// UI) and app/src/components/BrandLogo.tsx's BRAND_LOGO_LIGHT — kept as
// plain string literals here (this script has no way to import a React
// Native/TypeScript module directly) rather than parsed from those files,
// so a change to either constant must be mirrored here by hand — same
// "each tool is self-contained, kept in sync manually" convention this
// codebase already uses for Deno Edge Functions that can't import from
// app/src either.
const BG_COLOR = '#08080c'; // theme.ts colors.bg
const MARK_COLOR_LIGHT = '#ffffff'; // BrandLogo.tsx BRAND_LOGO_LIGHT
// SPLASH SCREEN WORDMARK (owner decision) — app/src/brand.ts's BRAND_NAME/
// BRAND_SHORT_NAME, copied as plain string literals for the same "each
// standalone tool keeps its own copy in sync by hand" reason as
// BG_COLOR/MARK_COLOR_LIGHT above (this script can't import a TS module).
//
// TWO LINES, NOT ONE (owner decision, round 4 — device report: "still too
// small... should be a clearly dominant element, not a caption," MEASURED
// after round 3's fix and found still small — see composeSplashWithWordmarkSvg's
// own header comment for the measured proof of why one line has a hard
// mathematical ceiling for this string). "BOZKA" (matching brand.ts's own
// BRAND_SHORT_NAME) / "TRUCKING AI" is the split that maximizes achievable
// font size — of every 2-line split of "BOZKA TRUCKING AI," this one
// minimizes the WIDER line's own character-weighted width (verified by
// computing all 3 reasonable splits directly, not assumed): "BOZKA" +
// "TRUCKING AI" -> the wider line's width-factor is 9.15; "BOZKA TRUCKING"
// + "AI" -> 11.79; one line -> 14.06. Since achievable fontSize is
// (available width) / (width-factor), the lowest width-factor wins the
// largest font — nearly 1.5x bigger than the next-best split, and ~1.6x
// bigger than the previous single-line, letter-spacing-only fixes ever
// could reach at this string length.
const WORDMARK_LINES = ['BOZKA', 'TRUCKING AI'];

// BrandLogo.tsx's own viewBox and 5 shapes, verbatim (stroke-based line
// art, strokeWidth 2, matching every stroke/fill/linejoin/linecap
// attribute exactly so the rendered mark is pixel-identical in spirit to
// what the app itself draws on screen).
const VIEWBOX_WIDTH = 48;
const VIEWBOX_HEIGHT = 26;
function truckMarkInnerSvg(color) {
  return `
    <rect x="14" y="4" width="31" height="14" rx="1" stroke="${color}" stroke-width="2" fill="none" />
    <path d="M4 18 V10 H9 L14 4 V18 Z" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" fill="none" />
    <path d="M2 18 H46" stroke="${color}" stroke-width="2" stroke-linecap="round" />
    <circle cx="9" cy="21" r="3" stroke="${color}" stroke-width="2" fill="none" />
    <circle cx="34" cy="21" r="3" stroke="${color}" stroke-width="2" fill="none" />
  `;
}

// Composes one square SVG document: an optional flat background fill,
// plus the truck mark scaled so it's `widthFraction` of the canvas WIDE
// (the mark is wider than it is tall, so width is always the binding
// constraint) and centered both ways. `widthFraction` is the one knob
// every call site below tunes for its own safe-zone requirements.
function composeSquareSvg({ size, backgroundColor, markColor, widthFraction, cornerRadius = 0 }) {
  const bg = backgroundColor
    ? cornerRadius > 0
      ? `<rect x="0" y="0" width="${size}" height="${size}" rx="${cornerRadius}" fill="${backgroundColor}" />`
      : `<rect x="0" y="0" width="${size}" height="${size}" fill="${backgroundColor}" />`
    : '';
  let mark = '';
  if (widthFraction > 0) {
    const markWidth = size * widthFraction;
    const markHeight = markWidth * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH);
    const scale = markWidth / VIEWBOX_WIDTH;
    const tx = (size - markWidth) / 2;
    const ty = (size - markHeight) / 2;
    mark = `<g transform="translate(${tx.toFixed(3)}, ${ty.toFixed(3)}) scale(${scale.toFixed(6)})">
      ${truckMarkInnerSvg(markColor)}
    </g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg}
    ${mark}
  </svg>`;
}

// Composes the launch-screen SVG: the truck mark, plus WORDMARK_TEXT
// centered directly beneath it — SPLASH SCREEN WORDMARK (owner decision).
// Transparent background, same as the plain splash mark this replaces —
// expo-splash-screen's own `backgroundColor: '#08080c'` in app.config.js
// already fills the rest of the screen (resizeMode "contain" means this
// whole composition scales down as one unit to fit, so making it taller
// than the bare mark alone needs no other config change). The mark keeps
// the EXACT SAME width/scale ICON_WIDTH_FRACTION already gives it (so the
// glyph itself looks identical to every other surface using that same
// fraction) — only its vertical position shifts up to make room for the
// wordmark sitting below it; the pair is then centered as ONE block
// within the square canvas, with generous padding on every side.
function composeSplashWithWordmarkSvg({ size, backgroundColor, markColor, textColor, widthFraction, lines }) {
  const markWidth = size * widthFraction;
  const markHeight = markWidth * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH);
  const scale = markWidth / VIEWBOX_WIDTH;
  const markTx = (size - markWidth) / 2;

  // WORDMARK SIZE, ROUND 4 — MEASURED AGAIN, ROOT-CAUSED FOR REAL (owner
  // decision, device report: "still too small" even after round 3's
  // height-driven fontSize). Round 3's own fontSize (~200px, derived from
  // 0.42 * markHeight) was computed correctly — but then this same
  // function's own MAX_TEXT_WIDTH_FRACTION safety clamp silently shrank
  // it back down to ~64px, because "BOZKA TRUCKING AI" (18 characters
  // including spaces) simply CANNOT fit on one line at anywhere close to
  // a 200px font within a 1024px-wide canvas — confirmed by measuring the
  // ACTUAL rendered round-3 PNG with scripts/_measureSplash.js: the text
  // band came out only 51px tall (5.0% of canvas height), nowhere near
  // the ~140px cap-height a 200px font would produce, proving the width
  // clamp — not the height formula — was the real governing constraint
  // the whole time. No amount of tuning the height ratio, weight, or
  // letter-spacing changes this: for THIS string on THIS canvas width,
  // one line has a hard mathematical ceiling around 60-80px regardless.
  //
  // THE ACTUAL FIX: wrap onto TWO LINES (see WORDMARK_LINES's own header
  // comment for why "BOZKA" / "TRUCKING AI" specifically) — this lets
  // fontSize be solved directly from the WIDER of the two lines' own
  // character-weighted width, which is what actually determines how big
  // the text can get. No more height-driven starting guess; the width
  // constraint was always binding, so this solves it directly instead of
  // computing a value that then gets silently overridden.
  const LETTER_SPACING_FACTOR = 0.16; // generous, proportional to fontSize
  const AVG_LETTER_WIDTH_FACTOR = 0.72; // measured at font-weight 900
  const AVG_SPACE_WIDTH_FACTOR = 0.35;
  const MAX_TEXT_WIDTH_FRACTION = 0.94; // safe canvas margin

  function widthFactor(line) {
    const letterCount = [...line].filter((c) => c !== ' ').length;
    const spaceCount = line.length - letterCount;
    const gapCount = Math.max(line.length - 1, 0);
    return letterCount * AVG_LETTER_WIDTH_FACTOR + spaceCount * AVG_SPACE_WIDTH_FACTOR + gapCount * LETTER_SPACING_FACTOR;
  }

  const maxTextWidth = size * MAX_TEXT_WIDTH_FRACTION;
  const widestLineFactor = Math.max(...lines.map(widthFactor));
  const fontSize = maxTextWidth / widestLineFactor;
  const letterSpacing = fontSize * LETTER_SPACING_FACTOR;

  // Clear separation from the mark, and a tighter gap BETWEEN the two
  // text lines than between the mark and the text block (owner decision —
  // the two lines should read as one cohesive wordmark, not two separate
  // elements).
  const markToTextGap = size * 0.11;
  const interLineGap = fontSize * 0.22;
  const lineHeight = fontSize; // cap-height-driven text-block spacing, not a full font em-box

  const blockHeight = markHeight + markToTextGap + lines.length * lineHeight + (lines.length - 1) * interLineGap;
  const blockTop = (size - blockHeight) / 2;
  const markTy = blockTop;

  const bg = backgroundColor ? `<rect x="0" y="0" width="${size}" height="${size}" fill="${backgroundColor}" />` : '';
  const textElements = lines
    .map((line, i) => {
      const lineTop = blockTop + markHeight + markToTextGap + i * (lineHeight + interLineGap);
      const baselineY = lineTop + fontSize * 0.78; // ~cap-height baseline offset
      return `<text
      x="${(size / 2).toFixed(3)}"
      y="${baselineY.toFixed(3)}"
      text-anchor="middle"
      font-family="Arial, Helvetica, sans-serif"
      font-weight="900"
      font-size="${fontSize.toFixed(3)}"
      letter-spacing="${letterSpacing.toFixed(3)}"
      fill="${textColor}"
    >${line}</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg}
    <g transform="translate(${markTx.toFixed(3)}, ${markTy.toFixed(3)}) scale(${scale.toFixed(6)})">
      ${truckMarkInnerSvg(markColor)}
    </g>
    ${textElements}
  </svg>`;
}

// Composes a rectangular (non-square) SVG document, for the Play Store
// feature graphic (1024x500) — same centering math, just against a
// rectangular canvas instead of a square one.
function composeRectSvg({ width, height, backgroundColor, markColor, widthFraction }) {
  const markWidth = width * widthFraction;
  const markHeight = markWidth * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH);
  const scale = markWidth / VIEWBOX_WIDTH;
  const tx = (width - markWidth) / 2;
  const ty = (height - markHeight) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="${backgroundColor}" />
    <g transform="translate(${tx.toFixed(3)}, ${ty.toFixed(3)}) scale(${scale.toFixed(6)})">
      ${truckMarkInnerSvg(markColor)}
    </g>
  </svg>`;
}

async function renderSvgToPng(svgString, outPath, { size } = {}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  let pipeline = sharp(Buffer.from(svgString));
  if (size) pipeline = pipeline.resize(size.width, size.height);
  await pipeline.png().toFile(outPath);
  console.log(`  wrote ${path.relative(process.cwd(), outPath)}`);
}

// APP-ICON SAFE-ZONE RATIOS:
// - 0.62 for the plain app icon / favicon / splash matches
//   BrandAppIcon.tsx's own existing `truckSize = size * 0.62` exactly (its
//   own comment: "leaves a comfortable margin, matches standard app-icon
//   safe zone conventions") — these three surfaces are never algorithmically
//   cropped/masked by the OS, so BrandAppIcon.tsx's own ratio is safe as-is.
// - 0.50 for the Android ADAPTIVE icon foreground/monochrome layers is
//   DELIBERATELY more conservative than the plain icon's 0.62 — Android
//   crops adaptive icons to a variety of OEM-chosen shapes (circle,
//   squircle, rounded square, teardrop, ...) and only guarantees the
//   INNER ~66% of the 108dp canvas survives every mask; 0.50 leaves real
//   margin below that guarantee rather than sitting right at its edge.
const ICON_WIDTH_FRACTION = 0.62;
const ADAPTIVE_WIDTH_FRACTION = 0.5;
// SPLASH SIZE FIX (owner decision, round 2 — device report: "still too
// small," verified — 0.62 is an APP-ICON safe-zone fraction, tuned so an
// OS icon-mask never clips the mark; a launch screen is displayed
// un-cropped via resizeMode "contain," so that safe-zone concern doesn't
// apply here at all. The REAL reason the splash read small on a real
// device: with the mark at only 0.62 of the 1024x1024 canvas and the
// wordmark sized relative to THAT (composeSplashWithWordmarkSvg's own
// TARGET_TEXT_WIDTH_FRACTION), roughly 20% of the canvas on every side was
// simply empty transparent padding no OS mask ever needed — and "contain"
// scales that WHOLE 1024x1024 image (padding included) to fit the
// device's width, so all that invisible margin was silently shrinking the
// visible content along with it. 0.86 shrinks that wasted margin down to
// roughly 7% per side, which is what actually makes the on-screen mark +
// wordmark noticeably bigger — not a further change to the text-to-mark
// ratio, which was already correct.
const SPLASH_WIDTH_FRACTION = 0.86;

const ROOT = path.resolve(__dirname, '..', '..'); // repo root
const ASSETS_DIR = path.join(ROOT, 'app', 'assets', 'images');
const STORE_ASSETS_DIR = path.join(ROOT, 'store-assets');

async function main() {
  console.log('Generating brand assets from BrandLogo.tsx/BrandAppIcon.tsx design...\n');

  // ---- app/assets/images/ — what app.config.js actually references ----
  console.log('app/assets/images/:');

  // icon.png (app.config.js `icon`, also the iOS icon source) — Expo/Apple
  // apply their OWN corner mask at build/display time, so this is a FULL-
  // BLEED flat square with NO pre-rounded corners baked in (rounding it
  // here would double up with the OS's own mask and could show background-
  // colored slivers at the corners).
  await renderSvgToPng(
    composeSquareSvg({ size: 1024, backgroundColor: BG_COLOR, markColor: MARK_COLOR_LIGHT, widthFraction: ICON_WIDTH_FRACTION }),
    path.join(ASSETS_DIR, 'icon.png')
  );

  // Android adaptive icon — three separate layers, matching app.config.js's
  // existing android.adaptiveIcon.{foregroundImage,backgroundImage,monochromeImage}.
  await renderSvgToPng(
    composeSquareSvg({ size: 1024, backgroundColor: null, markColor: MARK_COLOR_LIGHT, widthFraction: ADAPTIVE_WIDTH_FRACTION }),
    path.join(ASSETS_DIR, 'android-icon-foreground.png')
  );
  await renderSvgToPng(
    composeSquareSvg({ size: 1024, backgroundColor: BG_COLOR, markColor: MARK_COLOR_LIGHT, widthFraction: 0 }), // flat fill, no mark
    path.join(ASSETS_DIR, 'android-icon-background.png')
  );
  // Android 13+ themed ("monochrome") icon — OS applies its own tint, so
  // this is always a plain white shape on a transparent background
  // regardless of the app's own brand color, per Android's own convention.
  await renderSvgToPng(
    composeSquareSvg({ size: 1024, backgroundColor: null, markColor: '#ffffff', widthFraction: ADAPTIVE_WIDTH_FRACTION }),
    path.join(ASSETS_DIR, 'android-icon-monochrome.png')
  );

  // splash-icon.png (expo-splash-screen plugin, resizeMode "contain") —
  // the plugin's own `backgroundColor: '#08080c'` in app.config.js already
  // fills the rest of the screen, so this file is the mark + wordmark
  // ONLY on a transparent background — compositing it over that already-
  // correct background is what makes the launch screen match the app's
  // first screen seamlessly (no separate background-color fix needed
  // here). SPLASH SCREEN WORDMARK (owner decision): the app name now
  // renders beneath the truck mark, white, letter-spaced, small — see
  // composeSplashWithWordmarkSvg()'s own header comment for the layout
  // math. Every OTHER surface (icon.png, favicon, store assets, Android
  // adaptive layers) deliberately keeps the plain mark-only design — a
  // wordmark makes sense on a launch screen with room to breathe, not on
  // a tiny app-icon glyph.
  await renderSvgToPng(
    composeSplashWithWordmarkSvg({
      size: 1024,
      backgroundColor: null,
      markColor: MARK_COLOR_LIGHT,
      textColor: MARK_COLOR_LIGHT,
      widthFraction: SPLASH_WIDTH_FRACTION,
      lines: WORDMARK_LINES,
    }),
    path.join(ASSETS_DIR, 'splash-icon.png')
  );

  // favicon.png (web.favicon) — same full-bleed design as icon.png (a
  // browser tab favicon conventionally DOES show its own background,
  // unlike an OS-masked app icon), rendered smaller since browsers never
  // need more than a couple hundred px for a tab icon.
  await renderSvgToPng(
    composeSquareSvg({ size: 512, backgroundColor: BG_COLOR, markColor: MARK_COLOR_LIGHT, widthFraction: ICON_WIDTH_FRACTION }),
    path.join(ASSETS_DIR, 'favicon.png')
  );

  // ---- store-assets/ — what the actual store LISTINGS need (never read
  // by the app itself; upload these by hand to Play Console/App Store
  // Connect) ----
  console.log('\nstore-assets/:');

  // Play Store listing icon — 512x512, same full-bleed design as icon.png.
  await renderSvgToPng(
    composeSquareSvg({ size: 512, backgroundColor: BG_COLOR, markColor: MARK_COLOR_LIGHT, widthFraction: ICON_WIDTH_FRACTION }),
    path.join(STORE_ASSETS_DIR, 'play-store-icon-512.png')
  );

  // Play Store feature graphic — 1024x500, same background/mark, centered
  // on the wider rectangular canvas. Text-free, matching the icon's own
  // "no text in the icon" rule (Play Store already shows the app name
  // separately next to this graphic).
  await renderSvgToPng(
    composeRectSvg({ width: 1024, height: 500, backgroundColor: BG_COLOR, markColor: MARK_COLOR_LIGHT, widthFraction: 0.42 }),
    path.join(STORE_ASSETS_DIR, 'play-store-feature-graphic-1024x500.png')
  );

  // App Store listing icon — 1024x1024, identical design to icon.png
  // (Apple, like the Play Store icon above, wants a plain flat square
  // with no pre-applied corner rounding — it applies its own mask).
  await renderSvgToPng(
    composeSquareSvg({ size: 1024, backgroundColor: BG_COLOR, markColor: MARK_COLOR_LIGHT, widthFraction: ICON_WIDTH_FRACTION }),
    path.join(STORE_ASSETS_DIR, 'app-store-icon-1024.png')
  );

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
