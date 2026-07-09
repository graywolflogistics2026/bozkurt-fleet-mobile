import { planContributionSync } from '@/src/stats/contributionSync';

describe('planContributionSync', () => {
  it('creates a new contribution when personal-paid, positive amount, and no existing link', () => {
    const plan = planContributionSync({
      isPersonal: true,
      amount: 50,
      date: '2026-06-28',
      description: 'Milwaukee Drill — Truck maintenance/repair tool',
      paymentMethod: 'Personal Credit Card',
      existingContributionId: null,
    });
    expect(plan).toEqual({
      action: 'create',
      amount: 50,
      note: 'Milwaukee Drill — paid personally (Personal Credit Card)',
      date: '2026-06-28',
    });
  });

  it('updates the existing linked contribution when still personal-paid', () => {
    const plan = planContributionSync({
      isPersonal: true,
      amount: 75,
      date: '2026-06-28',
      description: 'Milwaukee Drill',
      paymentMethod: 'Cash',
      existingContributionId: 'contrib-1',
    });
    expect(plan).toEqual({
      action: 'update',
      id: 'contrib-1',
      amount: 75,
      note: 'Milwaukee Drill — paid personally (Cash)',
      date: '2026-06-28',
    });
  });

  it('removes the linked contribution when payment method is corrected back to business', () => {
    const plan = planContributionSync({
      isPersonal: false,
      amount: 50,
      date: '2026-06-28',
      description: 'Milwaukee Drill',
      paymentMethod: 'Business Credit Card',
      existingContributionId: 'contrib-1',
    });
    expect(plan).toEqual({ action: 'remove', id: 'contrib-1' });
  });

  it('is a no-op for a business-paid deduction with no existing link', () => {
    const plan = planContributionSync({
      isPersonal: false,
      amount: 50,
      date: '2026-06-28',
      description: 'Milwaukee Drill',
      paymentMethod: 'Business Credit Card',
      existingContributionId: null,
    });
    expect(plan).toEqual({ action: 'noop' });
  });

  it('treats a zero/negative amount as not warranting a contribution even if personal-paid', () => {
    expect(
      planContributionSync({
        isPersonal: true,
        amount: 0,
        date: '2026-06-28',
        description: 'Refund',
        paymentMethod: 'Cash',
        existingContributionId: null,
      })
    ).toEqual({ action: 'noop' });

    expect(
      planContributionSync({
        isPersonal: true,
        amount: 0,
        date: '2026-06-28',
        description: 'Refund',
        paymentMethod: 'Cash',
        existingContributionId: 'contrib-1',
      })
    ).toEqual({ action: 'remove', id: 'contrib-1' });
  });

  it('falls back to today when date is null', () => {
    const plan = planContributionSync({
      isPersonal: true,
      amount: 20,
      date: null,
      description: 'Item',
      paymentMethod: 'Cash',
      existingContributionId: null,
    });
    expect(plan.action).toBe('create');
    if (plan.action === 'create') {
      expect(plan.date).toBe(new Date().toISOString().slice(0, 10));
    }
  });
});
