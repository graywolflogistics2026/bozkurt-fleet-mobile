import { calcFleetHealthScore } from '@/src/stats/fleetHealthScore';

describe('calcFleetHealthScore', () => {
  it('scores 100 with all chips green when everything is on track', () => {
    const result = calcFleetHealthScore({
      truckHealthStatuses: ['ok', 'ok', 'no_data'],
      complianceUrgencies: ['ok', 'ok'],
      taxReserveRatio: 1.5,
      cashFlowDirection: 'up',
    });
    expect(result.score).toBe(100);
    expect(result.chips).toEqual({ truck: 'green', maintenance: 'green', taxes: 'green', cashFlow: 'green' });
  });

  it('turns the maintenance chip red when any truck-health category is overdue, regardless of the others', () => {
    const result = calcFleetHealthScore({
      truckHealthStatuses: ['ok', 'overdue'],
      complianceUrgencies: ['ok'],
      taxReserveRatio: 1,
      cashFlowDirection: 'up',
    });
    expect(result.chips.maintenance).toBe('red');
    expect(result.score).toBe(75);
  });

  it('turns the maintenance chip amber (not red) when the worst status is due_soon', () => {
    const result = calcFleetHealthScore({
      truckHealthStatuses: ['ok', 'due_soon'],
      complianceUrgencies: [],
      taxReserveRatio: null,
      cashFlowDirection: 'flat',
    });
    expect(result.chips.maintenance).toBe('amber');
  });

  it('turns the truck chip red when a compliance item is overdue', () => {
    const result = calcFleetHealthScore({
      truckHealthStatuses: [],
      complianceUrgencies: ['ok', 'overdue'],
      taxReserveRatio: 1,
      cashFlowDirection: 'up',
    });
    expect(result.chips.truck).toBe('red');
  });

  it('scores the taxes chip red below 50% reserve ratio, amber between 50-100%, green at 100%+', () => {
    expect(calcFleetHealthScore({ truckHealthStatuses: [], complianceUrgencies: [], taxReserveRatio: 0.3, cashFlowDirection: 'up' }).chips.taxes).toBe('red');
    expect(calcFleetHealthScore({ truckHealthStatuses: [], complianceUrgencies: [], taxReserveRatio: 0.7, cashFlowDirection: 'up' }).chips.taxes).toBe('amber');
    expect(calcFleetHealthScore({ truckHealthStatuses: [], complianceUrgencies: [], taxReserveRatio: 1, cashFlowDirection: 'up' }).chips.taxes).toBe('green');
  });

  it('treats a null tax reserve ratio (no quarterly payment data yet) as green — nothing to flag', () => {
    const result = calcFleetHealthScore({ truckHealthStatuses: [], complianceUrgencies: [], taxReserveRatio: null, cashFlowDirection: 'up' });
    expect(result.chips.taxes).toBe('green');
  });

  it('turns the cash-flow chip red on a down trend and amber (not red) on flat', () => {
    expect(calcFleetHealthScore({ truckHealthStatuses: [], complianceUrgencies: [], taxReserveRatio: 1, cashFlowDirection: 'down' }).chips.cashFlow).toBe('red');
    expect(calcFleetHealthScore({ truckHealthStatuses: [], complianceUrgencies: [], taxReserveRatio: 1, cashFlowDirection: 'flat' }).chips.cashFlow).toBe('amber');
  });

  it('scores 0 when every chip is red', () => {
    const result = calcFleetHealthScore({
      truckHealthStatuses: ['overdue'],
      complianceUrgencies: ['overdue'],
      taxReserveRatio: 0,
      cashFlowDirection: 'down',
    });
    expect(result.score).toBe(0);
  });
});
