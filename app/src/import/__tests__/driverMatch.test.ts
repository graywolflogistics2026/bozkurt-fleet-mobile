import { resolveDriverMatch } from '@/src/import/driverMatch';

const drivers = [
  { id: 'd1', name: 'John Smith' },
  { id: 'd2', name: 'Jane Doe' },
];

describe('resolveDriverMatch', () => {
  it('never surfaces a picker with 0 drivers on the account', () => {
    expect(resolveDriverMatch('John Smith', [])).toEqual({ driverId: null, needsPicker: false });
  });

  it('does not force a picker when no name was extracted, even with drivers on file', () => {
    expect(resolveDriverMatch(undefined, drivers)).toEqual({ driverId: null, needsPicker: false });
    expect(resolveDriverMatch('', drivers)).toEqual({ driverId: null, needsPicker: false });
  });

  it('auto-tags on an exact, case-insensitive, trimmed match', () => {
    expect(resolveDriverMatch('john smith', drivers)).toEqual({ driverId: 'd1', needsPicker: false });
    expect(resolveDriverMatch('  Jane Doe  ', drivers)).toEqual({ driverId: 'd2', needsPicker: false });
  });

  it('requires a picker when a name was extracted but matches zero drivers', () => {
    expect(resolveDriverMatch('Bob Nobody', drivers)).toEqual({ driverId: null, needsPicker: true });
  });

  it('requires a picker when the extracted name ambiguously matches more than one driver', () => {
    const dup = [...drivers, { id: 'd3', name: 'John Smith' }];
    expect(resolveDriverMatch('John Smith', dup)).toEqual({ driverId: null, needsPicker: true });
  });
});
