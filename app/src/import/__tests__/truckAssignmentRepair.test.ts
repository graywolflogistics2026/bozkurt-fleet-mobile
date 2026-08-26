import { findUnassignedRows } from '@/src/import/truckAssignmentRepair';

describe('findUnassignedRows', () => {
  it('finds only rows with a null truck_id, across all 4 tables', () => {
    const rows = findUnassignedRows(
      [
        { id: 's1', truck_id: null, week_ending: '2026-01-08', gross: 800, carrier: 'Prime' },
        { id: 's2', truck_id: 'ta', week_ending: '2026-01-01', gross: 5000 },
      ],
      [{ id: 'f1', truck_id: null, purchase_date: '2026-01-05', location: 'Pilot', amount: 400 }],
      [{ id: 'm1', truck_id: 'ta', service_date: '2026-01-03', description: 'Oil', cost: 100 }],
      [{ id: 't1', truck_id: null, toll_date: '2026-01-02', plaza: 'EZ', amount: 12 }]
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.kind).sort()).toEqual(['fuel', 'settlement', 'toll']);
  });

  it('returns an empty list when every row already has a truck', () => {
    const rows = findUnassignedRows(
      [{ id: 's1', truck_id: 'ta', week_ending: '2026-01-01', gross: 100 }],
      [],
      [],
      []
    );
    expect(rows).toEqual([]);
  });

  it('sorts newest first by date', () => {
    const rows = findUnassignedRows(
      [
        { id: 's1', truck_id: null, week_ending: '2026-01-01', gross: 100 },
        { id: 's2', truck_id: null, week_ending: '2026-02-01', gross: 100 },
      ],
      [],
      [],
      []
    );
    expect(rows.map((r) => r.id)).toEqual(['s2', 's1']);
  });
});
