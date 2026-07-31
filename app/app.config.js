// app.config.js — dynamic config (converted from a static app.json, owner
// decision 2026-07-30, RUNTIME VISIBILITY: "which JS is on this device
// should never be a guess again"). The ONLY reason for the conversion:
// EAS Build sets EAS_BUILD_GIT_COMMIT_HASH automatically during every
// cloud build — a static app.json has no way to read process.env at
// build time, so this becomes app/src/lib/buildInfo.ts's third signal
// (alongside app version and the EAS Update id) via
// Constants.expoConfig?.extra?.gitCommitHash. Local `expo start` dev runs
// simply won't have this env var set — buildInfo.ts treats that as
// "unknown," never throws. Everything else below is copied verbatim from
// the app.json this replaces.
module.exports = {
  expo: {
    name: 'Bozkurt Fleet OS',
    slug: 'bozkurt-fleet-os',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'bozkurtfleetos',
    userInterfaceStyle: 'dark',
    ios: {
      bundleIdentifier: 'com.bozkurtfleetos.app',
      buildNumber: '1',
      supportsTablet: true,
      infoPlist: {
        LSApplicationQueriesSchemes: ['instagram', 'fb', 'twitter', 'linkedin', 'tiktok', 'snssdk1233', 'driverpulse'],
      },
    },
    android: {
      package: 'com.bozkurtfleetos.app',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          resizeMode: 'contain',
          backgroundColor: '#08080c',
        },
      ],
      'expo-secure-store',
      [
        'expo-camera',
        {
          cameraPermission: 'Bozkurt Fleet OS uses your camera to photograph settlements, receipts, and maintenance invoices for AI-assisted import.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Bozkurt Fleet OS accesses your photo library so you can import a saved photo of a settlement, receipt, or invoice.',
        },
      ],
      'expo-localization',
      'expo-notifications',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: '965930e3-3b95-438a-81a5-f1a0c7136754',
      },
      gitCommitHash: process.env.EAS_BUILD_GIT_COMMIT_HASH || null,
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/965930e3-3b95-438a-81a5-f1a0c7136754',
    },
  },
};
