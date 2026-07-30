import { validateSignUpInput, resolveSignUpOutcome } from '@/src/auth/signUpFlow';

describe('validateSignUpInput (2026-07-30 silent-disabled-button fix)', () => {
  it('flags a missing/blank email', () => {
    expect(validateSignUpInput('', 'longenough')).toBe('missing_email');
    expect(validateSignUpInput('   ', 'longenough')).toBe('missing_email');
  });

  it('flags a password under 6 characters', () => {
    expect(validateSignUpInput('a@b.com', 'abc')).toBe('password_too_short');
    expect(validateSignUpInput('a@b.com', '12345')).toBe('password_too_short');
  });

  it('passes with an email and a 6+ character password', () => {
    expect(validateSignUpInput('a@b.com', '123456')).toBeNull();
  });

  it('email check takes priority when both are invalid', () => {
    expect(validateSignUpInput('', 'abc')).toBe('missing_email');
  });
});

describe('resolveSignUpOutcome — the two legitimate no-error branches', () => {
  it('returns an error outcome when Supabase reports one, regardless of session', () => {
    expect(resolveSignUpOutcome({ errorMessage: 'User already registered', hasSession: false })).toEqual({
      status: 'error',
      message: 'User already registered',
    });
    expect(resolveSignUpOutcome({ errorMessage: 'Some error', hasSession: true })).toEqual({
      status: 'error',
      message: 'Some error',
    });
  });

  it('returns "confirmation_required" when there is no error and no session (Confirm email is ON)', () => {
    expect(resolveSignUpOutcome({ errorMessage: null, hasSession: false })).toEqual({ status: 'confirmation_required' });
  });

  it('returns "signed_in" when there is no error and a session came back (Confirm email is OFF)', () => {
    expect(resolveSignUpOutcome({ errorMessage: null, hasSession: true })).toEqual({ status: 'signed_in' });
  });
});
