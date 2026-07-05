import { nextQuarterlyDeadline } from '@/src/tax/quarterly';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

const deadlines = fixtureTaxYearData.quarterly_deadlines;

describe('nextQuarterlyDeadline', () => {
  it('picks Q1 with normal urgency well before the deadline', () => {
    const result = nextQuarterlyDeadline(deadlines, new Date('2026-02-01T00:00:00'));
    expect(result).toMatchObject({ label: 'Q1', date: '2026-04-15', urgency: 'normal' });
  });

  it('flags warn urgency at exactly 30 days out', () => {
    const result = nextQuarterlyDeadline(deadlines, new Date('2026-03-16T00:00:00'));
    expect(result?.daysUntil).toBe(30);
    expect(result?.urgency).toBe('warn');
  });

  it('flags urgent at exactly 14 days out', () => {
    const result = nextQuarterlyDeadline(deadlines, new Date('2026-04-01T00:00:00'));
    expect(result?.daysUntil).toBe(14);
    expect(result?.urgency).toBe('urgent');
  });

  it('rolls over to Q2 the day after Q1 passes', () => {
    const result = nextQuarterlyDeadline(deadlines, new Date('2026-04-16T00:00:00'));
    expect(result?.label).toBe('Q2');
  });

  it('returns null after every deadline has passed', () => {
    const result = nextQuarterlyDeadline(deadlines, new Date('2027-02-01T00:00:00'));
    expect(result).toBeNull();
  });
});
