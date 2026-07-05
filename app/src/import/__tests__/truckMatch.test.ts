import { resolveTruckMatch } from '@/src/import/truckMatch';

const trucks = [
  { id: 't1', unit_number: '830157' },
  { id: 't2', unit_number: '830158' },
];

describe('resolveTruckMatch', () => {
  it('auto-tags silently with exactly 1 truck, regardless of extraction', () => {
    expect(resolveTruckMatch(undefined, [trucks[0]])).toEqual({ truckId: 't1', needsPicker: false });
    expect(resolveTruckMatch('999999', [trucks[0]])).toEqual({ truckId: 't1', needsPicker: false });
  });

  it('auto-tags silently when exactly one truck matches the extracted unit', () => {
    expect(resolveTruckMatch('830158', trucks)).toEqual({ truckId: 't2', needsPicker: false });
  });

  it('requires a picker when no unit was extracted and there are 2+ trucks', () => {
    expect(resolveTruckMatch(undefined, trucks)).toEqual({ truckId: null, needsPicker: true });
  });

  it('requires a picker when the extracted unit matches zero trucks (typo/new unit)', () => {
    expect(resolveTruckMatch('999999', trucks)).toEqual({ truckId: null, needsPicker: true });
  });

  it('requires a picker when the extracted unit ambiguously matches more than one truck', () => {
    const dup = [...trucks, { id: 't3', unit_number: '830158' }];
    expect(resolveTruckMatch('830158', dup)).toEqual({ truckId: null, needsPicker: true });
  });

  it('never surfaces a picker with 0 trucks on the account', () => {
    expect(resolveTruckMatch('830157', [])).toEqual({ truckId: null, needsPicker: false });
  });
});
