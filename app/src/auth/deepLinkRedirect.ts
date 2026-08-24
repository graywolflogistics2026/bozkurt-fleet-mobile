import Constants from 'expo-constants';

// Deliberately kept OUT of deepLink.ts (see that file's own header
// comment) — this is the one function that touches `expo-constants`,
// which cannot be imported under this repo's plain ts-jest/Node test
// environment (jest.config.js has no Expo/RN mocking).
export function buildAuthRedirectUrl(path: string): string {
  const scheme = Constants.expoConfig?.scheme;
  const schemeStr = (Array.isArray(scheme) ? scheme[0] : scheme) || 'bozkurtfleetos';
  return `${schemeStr}://${path}`;
}
