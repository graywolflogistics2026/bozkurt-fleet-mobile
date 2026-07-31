import { resolveLoanAssetMatch, type LoanMatchTruck, type LoanMatchEquipment } from '@/src/import/loanAssetMatch';

const trucks: LoanMatchTruck[] = [
  { id: 't1', unit_number: '4471', trailer_unit_number: 'TR-100' },
  { id: 't2', unit_number: '9002', trailer_unit_number: null },
];
const equipment: LoanMatchEquipment[] = [{ id: 'e1', name: 'Thermo King Reefer Unit' }];

describe('resolveLoanAssetMatch (ASSET PURCHASE & FINANCING, owner decision 2026-07-30)', () => {
  it('never forces a picker — no match just returns kind "none"', () => {
    expect(resolveLoanAssetMatch('truck', 'Unit 9999', trucks, equipment)).toEqual({ kind: 'none' });
  });

  it('matches a truck by unit_number (case-insensitive, trimmed)', () => {
    expect(resolveLoanAssetMatch('truck', ' 4471 ', trucks, equipment)).toEqual({ kind: 'truck', truckId: 't1' });
  });

  it('matches a trailer by trailer_unit_number', () => {
    expect(resolveLoanAssetMatch('trailer', 'tr-100', trucks, equipment)).toEqual({ kind: 'trailer', truckId: 't1' });
  });

  it('does not match a trailer name against unit_number (wrong field for assetType trailer)', () => {
    expect(resolveLoanAssetMatch('trailer', '4471', trucks, equipment)).toEqual({ kind: 'none' });
  });

  it('matches equipment by name', () => {
    expect(resolveLoanAssetMatch('equipment', 'Thermo King Reefer Unit', trucks, equipment)).toEqual({
      kind: 'equipment',
      equipmentId: 'e1',
    });
  });

  it('falls back to an equipment name match when assetType is unset/other but the name matches equipment', () => {
    expect(resolveLoanAssetMatch('other', 'Thermo King Reefer Unit', trucks, equipment)).toEqual({
      kind: 'equipment',
      equipmentId: 'e1',
    });
  });

  it('returns "none" when assetName is empty/missing', () => {
    expect(resolveLoanAssetMatch('truck', undefined, trucks, equipment)).toEqual({ kind: 'none' });
    expect(resolveLoanAssetMatch('truck', '', trucks, equipment)).toEqual({ kind: 'none' });
  });

  it('returns "none" on an ambiguous match (2+ trucks sharing the same unit_number)', () => {
    const dupeTrucks: LoanMatchTruck[] = [
      { id: 't1', unit_number: '4471', trailer_unit_number: null },
      { id: 't2', unit_number: '4471', trailer_unit_number: null },
    ];
    expect(resolveLoanAssetMatch('truck', '4471', dupeTrucks, equipment)).toEqual({ kind: 'none' });
  });
});
