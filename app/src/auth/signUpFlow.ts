// Sign-up form state machine (2026-07-30 bug fix) — extracted into pure,
// testable functions rather than inline component logic, same convention
// as src/navigation/rootRedirect.ts. Two things were silently swallowing
// every failure on a real device:
//   1. The Sign Up button was hard `disabled` (React Native never calls
//      onPress on a disabled Pressable) whenever the password was under 6
//      characters, with no inline hint of the minimum — a tap just did
//      nothing, indistinguishable from a broken button.
//   2. Supabase's signUp() has two legitimate "no error" outcomes
//      depending on the project's Auth > Email > "Confirm email" setting
//      (docs/PENDING_SQL.md-adjacent PROMPTS.md Session 10 checklist):
//      confirmation ON → success but no session yet (must check email);
//      confirmation OFF → success WITH a session (signed in immediately).
//      The UI must tell these apart rather than showing one hedged
//      "if email confirmation is required..." message for both.

export type SignUpValidationError = 'missing_email' | 'password_too_short';

// Runs BEFORE any network call — every path through this function is
// visible to the user (the caller always shows an error for a non-null
// result), so tapping the button can never silently do nothing again.
export function validateSignUpInput(email: string, password: string): SignUpValidationError | null {
  if (!email.trim()) return 'missing_email';
  if (password.length < 6) return 'password_too_short';
  return null;
}

export type SignUpOutcome = { status: 'error'; message: string } | { status: 'signed_in' } | { status: 'confirmation_required' };

export function resolveSignUpOutcome(params: { errorMessage: string | null; hasSession: boolean }): SignUpOutcome {
  if (params.errorMessage) return { status: 'error', message: params.errorMessage };
  return params.hasSession ? { status: 'signed_in' } : { status: 'confirmation_required' };
}
