import fs from 'fs';
import path from 'path';
import { owedToCarrier, printedTotalCashFlow } from '@/src/stats/owedToCarrier';
import type { HeldSettlement } from '@/src/stats/heldByCarrier';
import type { SettlementStatement } from '@/src/import/settlementStatement';
import en from '@/src/i18n/locales/en.json';

// OWED TO CARRIER (batch D2 part 1): READ from the latest statement's
// TOTAL CASH FLOW, never a sum of negative weeks. The golden weeks (8/14
// 3,072.57 and 8/21 1,884.73 -> nothing shows) are in the golden tests.

const stmt = (totalCashFlow: number | null): SettlementStatement =>
  ({ prime: { totals: { totalCashFlow } } }) as unknown as SettlementStatement;
const week = (id: string, week_ending: string, tcf: number | null, over: Partial<HeldSettlement> = {}): HeldSettlement => ({
  id,
  truck_id: 'T1',
  week_ending,
  carrier: 'Prime Inc',
  statement: stmt(tcf),
  ...over,
});

const fill = (s: string, o: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => o[k]);

describe('owedToCarrier', () => {
  it('-1,202.92 on the latest statement -> "Owed $1,202.92 as of 8/7"', () => {
    const r = owedToCarrier([week('a', '2026-07-31', 900), week('b', '2026-08-07', -1202.92)], 'T1');
    expect(r).toEqual({ total: 1202.92, asOf: '2026-08-07', accounts: [{ key: 'PRIME INC|truck:T1', truckId: 'T1', owed: 1202.92, asOf: '2026-08-07' }] });
    expect(fill(en.dashboard.hero.owedToCarrier, { amount: '$1,202.92', date: '8/7/2026' })).toBe('Owed $1,202.92 as of 8/7/2026');
  });

  it('the next week recovering it makes it vanish (8/14 TOTAL CASH FLOW 3,072.57)', () => {
    const r = owedToCarrier([week('b', '2026-08-07', -1202.92), week('c', '2026-08-14', 3072.57)], null);
    expect(r).toEqual({ total: 0, asOf: null, accounts: [] });
  });

  it('never sums negative weeks: two old negative weeks and a positive latest -> 0; latest negative -> only that one', () => {
    expect(owedToCarrier([week('a', '2026-07-24', -1417), week('b', '2026-07-31', -300), week('c', '2026-08-07', 50)], null).total).toBe(0);
    expect(owedToCarrier([week('a', '2026-07-24', -1417), week('b', '2026-07-31', -300)], null).total).toBe(300);
  });

  it('importing an older week later never changes it; a week without a printed TOTAL CASH FLOW is skipped', () => {
    const base = [week('c', '2026-08-14', -50)];
    expect(owedToCarrier([...base, week('z', '2026-06-01', -9999)], null).total).toBe(50);
    expect(owedToCarrier([...base, week('n', '2026-08-21', null)], null)).toMatchObject({ total: 50, asOf: '2026-08-14' });
  });

  it('per truck; fleet = each account’s latest; NULL-truck rows count in a truck scope', () => {
    const rows = [week('a', '2026-08-07', -100, { truck_id: 'T1' }), week('b', '2026-08-07', -40, { truck_id: 'T2' })];
    expect(owedToCarrier(rows, null).total).toBe(140);
    expect(owedToCarrier(rows, 'T2').total).toBe(40);
    expect(owedToCarrier([week('n', '2026-08-07', -25, { truck_id: null })], 'T1').total).toBe(25);
  });

  it('other carriers show nothing (no printed cash-flow line to read)', () => {
    expect(owedToCarrier([week('x', '2026-08-07', -500, { carrier: 'Acme Freight' })], null).total).toBe(0);
    expect(printedTotalCashFlow({ statement: null })).toBeNull();
  });

  it('no KPI sums owed weeks any more; Home reads owedToCarrier()', () => {
    const app = path.resolve(__dirname, '../../..');
    expect(fs.readFileSync(path.join(app, 'src/stats/kpi.ts'), 'utf8')).not.toMatch(/owedToCarrier\s*=\s*weekDeposits/);
    const home = fs.readFileSync(path.join(app, 'app/(tabs)/index.tsx'), 'utf8');
    expect(home).toContain('owedToCarrier(settlementsQuery.data');
    expect(home).toContain("t('dashboard.hero.owedSheetBody')");
    expect(en.dashboard.hero.owedSheetBody).toBe('Prime keeps this from your next settlements. It is not a bill.');
  });
});
