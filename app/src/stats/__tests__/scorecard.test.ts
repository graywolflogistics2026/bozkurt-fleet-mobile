import { calcScorecard } from '@/src/stats/scorecard';

describe('calcScorecard', () => {
  it('returns null (empty state) when there is no revenue or no miles yet', () => {
    expect(calcScorecard(0, 0, 1000, 0)).toBeNull();
    expect(calcScorecard(5000, 1000, 0, 500)).toBeNull();
  });

  it('awards full 90 points (25+25+25+15) for excellent RPM/fuel/net-per-mile, capped at 100', () => {
    // rpm=3.0 (>=2.5 -> 25), fpm=0.4 (<=0.5 -> 25), npm=1.0 (>=0.8 -> 25), +15 flat = 90
    const result = calcScorecard(3000, 2000, 1000, 400);
    expect(result?.score).toBe(90);
    expect(result?.grade).toBe('excellent');
  });

  it('grades "good" at 75-89', () => {
    // rpm=2.0 (20), fpm=0.6 (18), npm=0.6 exactly (18), +15 = 71... adjust to hit 75-89 band
    // rpm=2.5 (25) fpm=0.6 (18) npm=0.6 (18) +15 = 76
    const result = calcScorecard(2500, 1900, 1000, 600);
    expect(result?.revenuePerMile).toBe(2.5);
    expect(result?.score).toBe(76);
    expect(result?.grade).toBe('good');
  });

  it('grades "average" at 60-74', () => {
    // rpm=1.7 (12), fpm=0.8 (10), npm=0.4 (10), +15 = 47... need 60-74
    // rpm=2.0 (20) fpm=0.65 (18) npm=0.4 (10) +15 = 63
    const result = calcScorecard(2000, 1600, 1000, 650);
    expect(result?.score).toBe(63);
    expect(result?.grade).toBe('average');
  });

  it('grades "needs_work" below 60', () => {
    // rpm=1.0 (5), fpm=1.0 (3), npm=0.1 (3), +15 = 26
    const result = calcScorecard(1000, 900, 1000, 1000);
    expect(result?.score).toBe(26);
    expect(result?.grade).toBe('needs_work');
  });

  it('the +15 mileage bonus and each threshold are exact boundaries (legacy verbatim: >= not >)', () => {
    // rpm exactly 2.5 still earns the top 25pt tier
    const atThreshold = calcScorecard(2500, 0, 1000, 0);
    expect(atThreshold?.revenuePerMile).toBe(2.5);
    // fpm exactly 0.5 still earns the top fuel tier (<=, not <)
    const fuelAtThreshold = calcScorecard(1000, 0, 1000, 500);
    expect(fuelAtThreshold?.fuelPerMile).toBe(0.5);
  });

  it('never exceeds a 100 score even if every band were somehow overshot', () => {
    const result = calcScorecard(10000, 0, 1000, 100);
    expect(result?.score).toBeLessThanOrEqual(100);
  });
});
