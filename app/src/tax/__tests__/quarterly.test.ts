import { nextQuarterlyDeadline, allQuarterlyDeadlines } from '@/src/tax/quarterly';
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

describe('allQuarterlyDeadlines', () => {
  it('returns every deadline, not just the next upcoming one', () => {
    const result = allQuarterlyDeadlines(deadlines, new Date('2026-02-01T00:00:00'));
    expect(result).toHaveLength(deadlines.length);
    expect(result.map((r) => r.label)).toEqual(deadlines.map(([label]) => label));
  });

  it('marks a deadline that has already passed as isPast, with normal urgency regardless of how long ago', () => {
    const result = allQuarterlyDeadlines(deadlines, new Date('2026-04-16T00:00:00'));
    const q1 = result.find((r) => r.label === 'Q1');
    expect(q1?.isPast).toBe(true);
    expect(q1?.urgency).toBe('normal');
    expect(q1?.daysUntil).toBeLessThan(0);
  });

  it('marks a future deadline isPast:false and still applies the 14/30-day urgency thresholds', () => {
    const result = allQuarterlyDeadlines(deadlines, new Date('2026-04-01T00:00:00'));
    const q1 = result.find((r) => r.label === 'Q1');
    expect(q1?.isPast).toBe(false);
    expect(q1?.daysUntil).toBe(14);
    expect(q1?.urgency).toBe('urgent');
  });

  it('treats today (0 days out) as not yet past', () => {
    const result = allQuarterlyDeadlines(deadlines, new Date('2026-04-15T00:00:00'));
    const q1 = result.find((r) => r.label === 'Q1');
    expect(q1?.isPast).toBe(false);
    expect(q1?.daysUntil).toBe(0);
  });
});
