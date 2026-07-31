import type { ComponentType, ReactNode } from 'react';

// Metro (RN's bundler) provides a real `require` global at runtime even
// though this codebase writes ESM `import` everywhere — Babel compiles
// `import` down to `require()` calls under the hood. There's no
// `@types/node` dependency in this project (deliberately — pure-TS-module
// tests don't need it), so `require` has no ambient type without this
// local declaration; scoped to just this file, it doesn't leak a global
// `require` type into the rest of the app.
declare const require: (id: string) => unknown;

// CRASH-ON-MOUNT FIX (owner decision 2026-07-30, decisive device
// evidence: tapping Customize Dashboard showed a white flash then the
// screen closed/returned — a throw during module evaluation or initial
// render, BEFORE first paint, which is why the on-screen diagnostics
// panel from the prior pass never even appeared). Root cause: dashboard-
// customize.tsx imported `react-native-draggable-flatlist` (built on
// reanimated + react-native-gesture-handler) STATICALLY at the top of the
// file. If that native module fails to link/initialize in a release
// build, evaluating the screen's own module throws before React ever
// gets a chance to render anything — no error boundary, however placed,
// can catch a throw during `require()`/module evaluation, because the
// module (and everything after it in the file) never finishes loading.
//
// The fix: never import the drag module at the top level. Load it
// LAZILY, inside a useEffect (i.e. after the first successful render —
// never during the synchronous render pass), through this function,
// which is deliberately impossible to let throw past its own boundary —
// `requireFn` defaults to the ambient Metro `require`, and ANY failure
// (module not found, native init throwing, a malformed export shape)
// resolves to `null` instead of propagating. The arrows-only baseline
// therefore always renders FIRST (the component's dragModule state starts
// `null`), and only upgrades to drag-plus-arrows after a load that has
// already proven it won't crash.
export type DragModule = {
  DraggableFlatList: ComponentType<Record<string, unknown>>;
  ScaleDecorator: ComponentType<{ children?: ReactNode }>;
};

export function loadDragModule(requireFn: (id: string) => unknown = require): DragModule | null {
  try {
    const mod = requireFn('react-native-draggable-flatlist') as
      | { default?: ComponentType<Record<string, unknown>>; ScaleDecorator?: ComponentType<{ children?: ReactNode }> }
      | ComponentType<Record<string, unknown>>
      | null
      | undefined;
    if (!mod) return null;
    const DraggableFlatList = (mod as { default?: ComponentType<Record<string, unknown>> }).default ?? (mod as ComponentType<Record<string, unknown>>);
    const ScaleDecorator = (mod as { ScaleDecorator?: ComponentType<{ children?: ReactNode }> }).ScaleDecorator;
    if (!DraggableFlatList || !ScaleDecorator) return null;
    return { DraggableFlatList, ScaleDecorator };
  } catch {
    return null;
  }
}

// Pure decision table for what the screen should render — kept separate
// from the component so the full matrix (Expo Go / load failed / load
// not yet attempted / load succeeded) is unit-testable without needing to
// actually render React output. The rule is deliberately conservative:
// ANY doubt renders the guaranteed-safe arrows-only baseline.
export type DragRenderMode = 'arrows-only' | 'drag-plus-arrows';

export function resolveDragRenderMode(params: {
  isExpoGo: boolean;
  dragUnavailable: boolean;
  dragModule: DragModule | null;
}): DragRenderMode {
  if (params.isExpoGo) return 'arrows-only';
  if (params.dragUnavailable) return 'arrows-only';
  if (!params.dragModule) return 'arrows-only';
  return 'drag-plus-arrows';
}
