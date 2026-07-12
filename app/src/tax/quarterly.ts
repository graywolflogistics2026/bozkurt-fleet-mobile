import type { TaxYearData } from '@/src/types/db';

export type QuarterlyDeadlineStatus = {
  label: string;
  date: string;
  daysUntil: number;
  urgency: 'normal' | 'warn' | 'urgent'; // PROMPTS.md Session 5: orange <=30d, red <=14d
  isPast: boolean;
};

// Verbatim port of legacy's deadline-picking logic (legacy/index.html:2344-2351):
//   const next=deadlines.find(d=>new Date(d[1]+'T00:00:00')>=today);
//   ...days<=14 red, else <=30 orange, else muted.
// `deadlines`/`now` are parameters (not `new Date()` inline) so this is
// deterministic and testable.
export function nextQuarterlyDeadline(
  deadlines: TaxYearData['quarterly_deadlines'],
  now: Date = new Date()
): QuarterlyDeadlineStatus | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const next = deadlines.find(([, date]) => new Date(`${date}T00:00:00`) >= today);
  if (!next) return null;

  const [label, date] = next;
  const daysUntil = Math.ceil((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86400000);
  const urgency: QuarterlyDeadlineStatus['urgency'] = daysUntil <= 14 ? 'urgent' : daysUntil <= 30 ? 'warn' : 'normal';

  return { label, date, daysUntil, urgency, isPast: false };
}

// The Tax Estimator screen's full quarterly schedule shows every deadline,
// not just the next upcoming one — a past deadline still displays (marked
// isPast) so the year's full Q1-Q4 schedule always reads as a complete
// list, matching legacy's own always-show-all-four quarterly breakdown.
export function allQuarterlyDeadlines(
  deadlines: TaxYearData['quarterly_deadlines'],
  now: Date = new Date()
): QuarterlyDeadlineStatus[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return deadlines.map(([label, date]) => {
    const daysUntil = Math.ceil((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86400000);
    const isPast = daysUntil < 0;
    const urgency: QuarterlyDeadlineStatus['urgency'] = isPast ? 'normal' : daysUntil <= 14 ? 'urgent' : daysUntil <= 30 ? 'warn' : 'normal';
    return { label, date, daysUntil, urgency, isPast };
  });
}
