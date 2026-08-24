// Pure validation for the "set a new password" form (reset-password.tsx) —
// same convention/6-char minimum as signUpFlow.ts's validateSignUpInput(),
// plus the confirm-field match check that screen doesn't need.
export type NewPasswordError = 'too_short' | 'mismatch';

export function validateNewPassword(password: string, confirmPassword: string): NewPasswordError | null {
  if (password.length < 6) return 'too_short';
  if (password !== confirmPassword) return 'mismatch';
  return null;
}

// Resend-cooldown timer (forgot-password.tsx / check-email.tsx /
// confirm-email.tsx all use the identical 60s cooldown) — a pure function
// so the countdown logic itself is testable without a real setInterval.
export const RESEND_COOLDOWN_SECONDS = 60;

export function nextCooldownValue(currentSeconds: number): number {
  return Math.max(0, currentSeconds - 1);
}
