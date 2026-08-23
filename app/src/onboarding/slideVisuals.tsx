// FIRST-RUN TUTORIAL VISUALS (owner decision 2026-08-05, FULL PARITY
// follow-up item I) — one shared registry mapping a slide id to its
// visual. Today every slide renders an in-app react-native-svg scene
// (SLIDE_VISUALS below) — no new native dependency, works offline, scales
// cleanly to any screen size. This registry is deliberately the ONE
// place a future pass would swap a slide's SVG for a real illustration
// (see assets/tour/README.md for the expected file names/shapes) without
// touching the pager component itself — that call site just does
// `SLIDE_VISUALS[slide.id]`.
import Svg, { Circle, Path, Rect, Line } from 'react-native-svg';
import { colors } from '@/src/theme';
import type { TutorialSlideId } from '@/src/onboarding/tutorialSlides';

type VisualProps = { size: number };

// 1. Snap it — a phone/camera framing a document.
function SnapVisual({ size }: VisualProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="55" y="30" width="90" height="130" rx="10" fill={colors.card2} stroke={colors.accent} strokeWidth="3" />
      <Rect x="72" y="55" width="56" height="70" rx="4" fill={colors.card} stroke={colors.border} strokeWidth="2" />
      <Line x1="80" y1="70" x2="120" y2="70" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Line x1="80" y1="82" x2="112" y2="82" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Line x1="80" y1="94" x2="118" y2="94" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Circle cx="100" cy="40" r="4" fill={colors.accent} />
      {/* corner-frame brackets, camera-viewfinder motif */}
      <Path d="M30 45 v-15 h15" stroke={colors.green} strokeWidth="4" fill="none" strokeLinecap="round" />
      <Path d="M170 45 v-15 h-15" stroke={colors.green} strokeWidth="4" fill="none" strokeLinecap="round" />
      <Path d="M30 155 v15 h15" stroke={colors.green} strokeWidth="4" fill="none" strokeLinecap="round" />
      <Path d="M170 155 v15 h-15" stroke={colors.green} strokeWidth="4" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

// 2. AI reads it — a document with a scan-line + sparkle.
function AiReadsVisual({ size }: VisualProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="60" y="30" width="80" height="110" rx="8" fill={colors.card2} stroke={colors.border} strokeWidth="2" />
      <Line x1="72" y1="55" x2="128" y2="55" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Line x1="72" y1="68" x2="120" y2="68" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Line x1="72" y1="81" x2="124" y2="81" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Line x1="72" y1="94" x2="116" y2="94" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      {/* scan beam */}
      <Rect x="60" y="105" width="80" height="6" rx="3" fill={colors.accent} opacity={0.85} />
      {/* sparkle */}
      <Path d="M148 45 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" fill={colors.purple} />
      <Circle cx="45" cy="130" r="5" fill={colors.purple} opacity={0.6} />
    </Svg>
  );
}

// 3. You confirm — a document with a big checkmark.
function ConfirmVisual({ size }: VisualProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="55" y="35" width="90" height="120" rx="8" fill={colors.card2} stroke={colors.border} strokeWidth="2" />
      <Line x1="68" y1="58" x2="118" y2="58" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Line x1="68" y1="71" x2="110" y2="71" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Line x1="68" y1="84" x2="114" y2="84" stroke={colors.muted} strokeWidth="3" strokeLinecap="round" />
      <Circle cx="140" cy="130" r="34" fill={colors.green} opacity={0.15} />
      <Circle cx="140" cy="130" r="30" fill="none" stroke={colors.green} strokeWidth="4" />
      <Path d="M126 130 l10 10 l20 -22" stroke={colors.green} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// 4. It lands everywhere — a central document branching into several ledgers.
function LandsEverywhereVisual({ size }: VisualProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="80" y="20" width="40" height="50" rx="6" fill={colors.card2} stroke={colors.accent} strokeWidth="2" />
      <Line x1="88" y1="35" x2="112" y2="35" stroke={colors.muted} strokeWidth="2" strokeLinecap="round" />
      <Line x1="88" y1="45" x2="108" y2="45" stroke={colors.muted} strokeWidth="2" strokeLinecap="round" />
      {/* branches to 4 destination boxes */}
      <Path d="M100 70 L45 120" stroke={colors.border} strokeWidth="2" fill="none" />
      <Path d="M100 70 L85 130" stroke={colors.border} strokeWidth="2" fill="none" />
      <Path d="M100 70 L115 130" stroke={colors.border} strokeWidth="2" fill="none" />
      <Path d="M100 70 L155 120" stroke={colors.border} strokeWidth="2" fill="none" />
      <Rect x="25" y="120" width="40" height="30" rx="5" fill={colors.card} stroke={colors.green} strokeWidth="2" />
      <Rect x="70" y="130" width="40" height="30" rx="5" fill={colors.card} stroke={colors.orange} strokeWidth="2" />
      <Rect x="100" y="130" width="40" height="30" rx="5" fill={colors.card} stroke={colors.purple} strokeWidth="2" />
      <Rect x="135" y="120" width="40" height="30" rx="5" fill={colors.card} stroke={colors.accent} strokeWidth="2" />
    </Svg>
  );
}

// 5. Your documents are kept — a shield with a document + lock.
function DocumentsKeptVisual({ size }: VisualProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Path
        d="M100 25 L150 45 V95 C150 130 128 155 100 168 C72 155 50 130 50 95 V45 Z"
        fill={colors.card2}
        stroke={colors.accent}
        strokeWidth="3"
      />
      <Rect x="80" y="90" width="40" height="32" rx="5" fill={colors.card} stroke={colors.border} strokeWidth="2" />
      <Path d="M88 90 v-10 a12 12 0 0 1 24 0 v10" stroke={colors.muted} strokeWidth="3" fill="none" />
      <Circle cx="100" cy="106" r="4" fill={colors.accent} />
    </Svg>
  );
}

// 6. Ready for your accountant — a folder with a document + checkmark.
function ReadyForAccountantVisual({ size }: VisualProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Path d="M35 65 h45 l12 15 h73 v75 a8 8 0 0 1 -8 8 H43 a8 8 0 0 1 -8 -8 Z" fill={colors.card2} stroke={colors.orange} strokeWidth="3" />
      <Rect x="85" y="55" width="55" height="70" rx="6" fill={colors.card} stroke={colors.border} strokeWidth="2" />
      <Line x1="95" y1="72" x2="130" y2="72" stroke={colors.muted} strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="95" y1="83" x2="125" y2="83" stroke={colors.muted} strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="95" y1="94" x2="128" y2="94" stroke={colors.muted} strokeWidth="2.5" strokeLinecap="round" />
      <Circle cx="112" cy="112" r="9" fill={colors.green} />
      <Path d="M108 112 l3 3 l6 -7" stroke={colors.card} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export const SLIDE_VISUALS: Record<TutorialSlideId, (props: VisualProps) => React.JSX.Element> = {
  snap: SnapVisual,
  aiReads: AiReadsVisual,
  confirm: ConfirmVisual,
  landsEverywhere: LandsEverywhereVisual,
  documentsKept: DocumentsKeptVisual,
  readyForAccountant: ReadyForAccountantVisual,
};
