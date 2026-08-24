// Scoped to the pure tax-engine/stats modules (no React Native / Expo
// runtime involved), so a plain ts-jest preset is enough — no jest-expo or
// RN mocking needed. Pinned to jest 29.x (not the current 30.x) because
// jest 30's default resolver (unrs-resolver) ships a native binding that
// fails to load on this machine ("Cannot find native binding" / dlopen
// failure even though the .node file is present) — jest 29 doesn't have
// that dependency at all.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/tax/**/*.test.ts',
    '<rootDir>/src/stats/**/*.test.ts',
    '<rootDir>/src/import/**/*.test.ts',
    '<rootDir>/src/i18n/**/*.test.ts',
    '<rootDir>/src/truck/**/*.test.ts',
    '<rootDir>/src/dashboard/**/*.test.ts',
    '<rootDir>/src/lib/**/*.test.ts',
    '<rootDir>/src/compliance/**/*.test.ts',
    '<rootDir>/src/navigation/**/*.test.ts',
    '<rootDir>/src/auth/**/*.test.ts',
    '<rootDir>/src/data/__tests__/*.test.ts',
    '<rootDir>/src/legal/**/*.test.ts',
    '<rootDir>/src/components/**/*.test.ts',
    '<rootDir>/src/onboarding/**/*.test.ts',
    '<rootDir>/src/alerts/**/*.test.ts',
    '<rootDir>/src/referral/**/*.test.ts',
    '<rootDir>/src/entitlement/**/*.test.ts',
    '<rootDir>/src/usage/**/*.test.ts',
  ],
  // Mirrors tsconfig.json's "@/*" path alias — ts-jest doesn't read tsconfig
  // paths for module resolution on its own.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
