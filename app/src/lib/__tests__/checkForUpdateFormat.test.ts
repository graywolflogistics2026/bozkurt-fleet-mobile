import { mapCheckForUpdateOutcome } from '@/src/lib/checkForUpdateFormat';

describe('mapCheckForUpdateOutcome (CHECK FOR UPDATE NOW, owner decision)', () => {
  it('reports "disabled" when Updates.isEnabled is false, regardless of outcome', () => {
    expect(mapCheckForUpdateOutcome(false, { type: 'not-available' })).toEqual({
      status: 'disabled',
      message: expect.stringContaining('Updates.isEnabled === false'),
    });
    // Even an "available" outcome must not override the disabled check —
    // isEnabled === false means this build cannot apply an update at all,
    // no matter what the (hypothetical) check itself would have said.
    expect(mapCheckForUpdateOutcome(false, { type: 'available', manifestId: 'abc' }).status).toBe('disabled');
  });

  it('reports "error" with the exact caught message, never a generic placeholder', () => {
    const result = mapCheckForUpdateOutcome(true, { type: 'error', message: 'Network request failed' });
    expect(result).toEqual({ status: 'error', message: 'Network request failed' });
  });

  it('reports "update-available" with the manifest id when one is present', () => {
    const result = mapCheckForUpdateOutcome(true, { type: 'available', manifestId: 'manifest-123' });
    expect(result.status).toBe('update-available');
    expect(result).toMatchObject({ manifestId: 'manifest-123' });
  });

  it('reports "update-available" with a null manifest id when none is present', () => {
    const result = mapCheckForUpdateOutcome(true, { type: 'available', manifestId: null });
    expect(result).toMatchObject({ status: 'update-available', manifestId: null });
  });

  it('reports "up-to-date" when enabled and no update is available', () => {
    expect(mapCheckForUpdateOutcome(true, { type: 'not-available' }).status).toBe('up-to-date');
  });
});
