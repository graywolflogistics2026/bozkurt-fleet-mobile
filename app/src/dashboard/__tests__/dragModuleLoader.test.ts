import { loadDragModule, resolveDragRenderMode } from '@/src/dashboard/dragModuleLoader';

const FakeDraggableFlatList = () => null;
const FakeScaleDecorator = () => null;

describe('loadDragModule (CRASH-ON-MOUNT FIX, owner decision 2026-07-30)', () => {
  it('returns the module when require succeeds with a default export + ScaleDecorator', () => {
    const requireFn = () => ({ default: FakeDraggableFlatList, ScaleDecorator: FakeScaleDecorator });
    const result = loadDragModule(requireFn);
    expect(result).toEqual({ DraggableFlatList: FakeDraggableFlatList, ScaleDecorator: FakeScaleDecorator });
  });

  it('returns null instead of throwing when require() itself throws (the exact reported crash-on-mount scenario)', () => {
    const requireFn = () => {
      throw new Error('Native module RNGestureHandlerModule not found');
    };
    expect(() => loadDragModule(requireFn)).not.toThrow();
    expect(loadDragModule(requireFn)).toBeNull();
  });

  it('tolerates a module with no `default` key by using the module object itself as the component (CJS/ESM interop)', () => {
    // require() is expected to resolve { default: Component, ScaleDecorator }
    // for this specific library, but the fallback (mod.default ?? mod) is a
    // deliberate defensive allowance for interop shapes where the module
    // itself IS the component — this proves that fallback, not a crash.
    const requireFn = () => ({ ScaleDecorator: FakeScaleDecorator });
    const result = loadDragModule(requireFn);
    expect(result).not.toBeNull();
    expect(result?.ScaleDecorator).toBe(FakeScaleDecorator);
  });

  it('returns null when require() resolves but ScaleDecorator is missing', () => {
    const requireFn = () => ({ default: FakeDraggableFlatList });
    expect(loadDragModule(requireFn)).toBeNull();
  });

  it('returns null when require() resolves to null/undefined', () => {
    expect(loadDragModule(() => null)).toBeNull();
    expect(loadDragModule(() => undefined)).toBeNull();
  });

  it('returns null when require() throws something that is not an Error instance', () => {
    const requireFn = () => {
      // eslint-disable-next-line no-throw-literal
      throw 'native init failure';
    };
    expect(() => loadDragModule(requireFn)).not.toThrow();
    expect(loadDragModule(requireFn)).toBeNull();
  });
});

describe('resolveDragRenderMode', () => {
  it('is always arrows-only inside Expo Go, regardless of module state', () => {
    expect(resolveDragRenderMode({ isExpoGo: true, dragUnavailable: false, dragModule: null })).toBe('arrows-only');
    expect(
      resolveDragRenderMode({
        isExpoGo: true,
        dragUnavailable: false,
        dragModule: { DraggableFlatList: FakeDraggableFlatList, ScaleDecorator: FakeScaleDecorator },
      })
    ).toBe('arrows-only');
  });

  it('is arrows-only before the lazy load has resolved (dragModule still null) — the default, safe first-paint state', () => {
    expect(resolveDragRenderMode({ isExpoGo: false, dragUnavailable: false, dragModule: null })).toBe('arrows-only');
  });

  it('is arrows-only once dragUnavailable is set, even if a module happens to be present', () => {
    expect(
      resolveDragRenderMode({
        isExpoGo: false,
        dragUnavailable: true,
        dragModule: { DraggableFlatList: FakeDraggableFlatList, ScaleDecorator: FakeScaleDecorator },
      })
    ).toBe('arrows-only');
  });

  it('upgrades to drag-plus-arrows only when not Expo Go, not unavailable, AND a module is loaded', () => {
    expect(
      resolveDragRenderMode({
        isExpoGo: false,
        dragUnavailable: false,
        dragModule: { DraggableFlatList: FakeDraggableFlatList, ScaleDecorator: FakeScaleDecorator },
      })
    ).toBe('drag-plus-arrows');
  });
});
