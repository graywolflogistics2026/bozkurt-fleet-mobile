import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Session 9d item 7 ("money values count up on mount") — a plain
// requestAnimationFrame-driven counter, not reanimated: the caller
// formats the interpolated number through Intl.NumberFormat
// (useFormatters()), which is JS-only and can't run as a UI-thread
// worklet anyway. Animates whenever `target` changes from its previous
// value (the common "0/undefined while loading -> real number" case
// reads as counting up on mount; a later refetch with a different value
// animates too, which is the same look pull-to-refresh screens already
// use elsewhere). Skips straight to the target when the OS reduced-
// motion setting is on.
export function useAnimatedNumber(target: number, durationMs = 800): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    let cancelled = false;
    let raf: number;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        setDisplay(target);
        fromRef.current = target;
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        setDisplay(from + (target - from) * progress);
        if (progress < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          fromRef.current = target;
        }
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);

  return display;
}
