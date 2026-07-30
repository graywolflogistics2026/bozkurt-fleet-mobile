// This file did not exist before 2026-07-30 (real-device bug fix) —
// without it, Metro had no babel config to load at all, so it silently
// fell back to a bare-bones default transform with no knowledge of this
// project's Expo-specific needs. The concrete symptom: react-native-
// draggable-flatlist's long-press-to-lift gesture (Customize Dashboard)
// never worked on a real device, because babel-preset-expo is the ONLY
// thing that auto-injects react-native-worklets' babel plugin when
// react-native-worklets is installed (confirmed in babel-preset-expo
// 54.0.11's own source) — without that plugin, every `'worklet'`-tagged
// function used by react-native-reanimated/react-native-gesture-handler
// (which draggable-flatlist's drag animation is built on) never got
// transformed, so the drag gesture silently did nothing. This is a
// Metro/bundling-time fix, not a native one — it takes effect through
// `eas update` the same as any other JS change, no rebuild required.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
