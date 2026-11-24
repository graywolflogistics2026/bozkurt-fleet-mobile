// T1 — THE OWNER'S NUMBERS DO NOT MOVE (owner 2026-11-24,
// docs/decisions/toll-rule-profit-core-proposal.md §3). The owner's real
// toll rows (fixtures/ownerTolls.ts: 6 Prime weeks, 11 itemized tolls rows,
// 2 own CAT Scale tickets) with every week statement-backed, as on the
// device ("all 18 weeks certified"). Every profit figure below was recorded
// on the code BEFORE the toll rule reached the profit core and must stay
// identical after it: the rule only removes tolls rows that a backed week
// already keeps out of every sum.
import { computeKpis, type KpiResult } from '@/src/stats/kpi';
import { buildPeriodScopedCpm } from '@/src/stats/periodScopedCpm';
import { HERO_PERIODS } from '@/src/stats/heroPeriod';
import { buildTruckComparison } from '@/src/stats/truckComparison';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { buildWeeklyTrueProfitTrend, calcTrueProfit } from '@/src/stats/trueProfit';
import { NOW, PRIME, deductions as ownerDeductions, settlements as ownerSettlements, tolls as ownerTolls } from './fixtures/ownerTolls';

const r2 = (n: number) => Math.round(n * 100) / 100;
const TRUCK = 'T1';
const GROSS = 2000;

// Each week: a passing Prime statement whose only expense line is the
// week's withheld Tolls & Scales lines (other categories counted the same way).
const weekOf = new Map(ownerSettlements.map((s) => [s.id, s.week_ending!]));
const deductions = ownerDeductions.map((d) => ({
  ...d,
  // Withheld lines dated on their week ending (as Prime prints them).
  ded_date: d.settlement_id ? weekOf.get(d.settlement_id)! : d.ded_date,
  tax_deductible: true,
  truck_id: null,
}));
const withheldOf = (sid: string) => r2(deductions.filter((d) => d.settlement_id === sid).reduce((a, d) => a + (d.amount ?? 0), 0));
const settlements = ownerSettlements.map((s) => {
  const exp = withheldOf(s.id);
  const net = r2(GROSS - exp);
  return {
    id: s.id,
    week_ending: s.week_ending,
    carrier: PRIME,
    truck_id: TRUCK,
    gross: GROSS,
    net,
    miles: 1000,
    statement: {
      source: 'prime_statement',
      printed: { grossRevenue: GROSS, deposit: net, depositSource: 'printed' },
      prime: {
        gatePassed: true,
        lines: [
          { section: 'revenue', label: 'TOTAL REVENUE', amount: GROSS },
          { section: 'misc', label: 'TOLLS', amount: -exp },
        ],
        totals: { totalRevenue: GROSS, totalMiscellaneous: -exp, totalVariableCosts: -exp, totalOperatingExpenses: -exp, totalStatement: net, priorWeekBalanceForward: 0 },
      },
    },
  };
});
const tolls = ownerTolls.map((t) => ({ ...t, truck_id: null }));
const trucks = [{ id: TRUCK, unit_number: '283940' }];
const WEEK_ENDINGS = settlements.map((s) => s.week_ending!).sort();

const kpiFigures = (k: KpiResult) => ({
  gross: r2(k.gross),
  expenses: r2(k.expenses.total),
  fixed: r2(k.expenses.fixed),
  variable: r2(k.expenses.variable),
  net: r2(k.net),
  cpm: k.cpm == null ? null : r2(k.cpm),
  ppm: k.ppm == null ? null : r2(k.ppm),
  statementExpenses: r2(k.statementExpenses),
  buckets: k.buckets.map((b) => [b.category, r2(b.amount)]),
  ledgerCounted: r2(k.ledger.filter((l) => l.status === 'counted').reduce((a, l) => a + l.amount, 0)),
  ledgerRows: k.ledger.length,
  bridgeDifference: k.bridge.difference,
  crossChecks: k.bridge.crossChecks.length,
});

function ownerSnapshot() {
  const base = { trucks: trucks as never, settlements: settlements as never, loads: [], deductions: deductions as never, fuelPurchases: [], maintenanceRecords: [], tolls: tolls as never, reimbursements: [] };
  const periods = Object.fromEntries(
    HERO_PERIODS.map((p) => {
      const res = buildPeriodScopedCpm(p, WEEK_ENDINGS, trucks as never, settlements as never, [], deductions as never, [], [], tolls as never, [], TRUCK, null, NOW);
      return [p, { kpi: res.kpi ? kpiFigures(res.kpi) : null, rows: res.comparison.rows.map((r) => [r.truckId, r2(r.totalExpenses), r2(r.netProfit)]) }];
    })
  );
  const pa = buildProfitAnalysis(settlements as never, [], [], deductions as never, [], null, NOW, tolls as never);
  return {
    allFleet: kpiFigures(computeKpis({ ...base, truckScope: null, window: null })),
    allTruck: kpiFigures(computeKpis({ ...base, truckScope: TRUCK, window: null })),
    periods,
    comparison: buildTruckComparison(trucks as never, settlements as never, [], deductions as never, [], [], tolls as never, []).rows.map((r) => [r.truckId, r2(r.totalExpenses), r2(r.netProfit)]),
    weekly: buildWeeklyTrueProfitTrend(settlements as never, deductions as never, [], [], tolls as never, []).map((p) => [p.weekEnding, r2(p.gross), r2(p.net)]),
    profitAnalysis: [r2(pa.revenue), r2(pa.totalExpenses), r2(pa.netIncome)],
    trueProfit: r2(calcTrueProfit(settlements as never, deductions as never, [], [], tolls as never, [])),
  };
}

// Recorded on the unchanged code (commit fe85b4b + c6ac189), 2026-11-24.
// Fixture gross is 2,000.00 a week (not the owner's real gross); the toll
// rows, toll lines and own CAT tickets are the owner's real ones.
const BEFORE = {
  "allFleet": {
    "gross": 12000,
    "expenses": 926.47,
    "fixed": 0,
    "variable": 926.47,
    "net": 11073.53,
    "cpm": 0.15,
    "ppm": 1.85,
    "statementExpenses": 895.97,
    "buckets": [
      [
        "Tolls",
        926.47
      ]
    ],
    "ledgerCounted": 926.47,
    "ledgerRows": 8,
    "bridgeDifference": 0,
    "crossChecks": 0
  },
  "allTruck": {
    "gross": 12000,
    "expenses": 926.47,
    "fixed": 0,
    "variable": 926.47,
    "net": 11073.53,
    "cpm": 0.15,
    "ppm": 1.85,
    "statementExpenses": 895.97,
    "buckets": [
      [
        "Tolls",
        926.47
      ]
    ],
    "ledgerCounted": 926.47,
    "ledgerRows": 8,
    "bridgeDifference": 0,
    "crossChecks": 0
  },
  "periods": {
    "thisWeek": {
      "kpi": {
        "gross": 2000,
        "expenses": 187.03,
        "fixed": 0,
        "variable": 187.03,
        "net": 1812.97,
        "cpm": 0.19,
        "ppm": 1.81,
        "statementExpenses": 187.03,
        "buckets": [
          [
            "Tolls",
            187.03
          ]
        ],
        "ledgerCounted": 187.03,
        "ledgerRows": 1,
        "bridgeDifference": 0,
        "crossChecks": 0
      },
      "rows": [
        [
          "T1",
          187.03,
          1812.97
        ]
      ]
    },
    "lastWeek": {
      "kpi": {
        "gross": 2000,
        "expenses": 252.5,
        "fixed": 0,
        "variable": 252.5,
        "net": 1747.5,
        "cpm": 0.25,
        "ppm": 1.75,
        "statementExpenses": 252.5,
        "buckets": [
          [
            "Tolls",
            252.5
          ]
        ],
        "ledgerCounted": 252.5,
        "ledgerRows": 1,
        "bridgeDifference": 0,
        "crossChecks": 0
      },
      "rows": [
        [
          "T1",
          252.5,
          1747.5
        ]
      ]
    },
    "1M": {
      "kpi": {
        "gross": 2000,
        "expenses": 202.28,
        "fixed": 0,
        "variable": 202.28,
        "net": 1797.72,
        "cpm": 0.2,
        "ppm": 1.8,
        "statementExpenses": 187.03,
        "buckets": [
          [
            "Tolls",
            202.28
          ]
        ],
        "ledgerCounted": 202.28,
        "ledgerRows": 2,
        "bridgeDifference": 0,
        "crossChecks": 0
      },
      "rows": [
        [
          "T1",
          202.28,
          1797.72
        ]
      ]
    },
    "3M": {
      "kpi": {
        "gross": 10000,
        "expenses": 926.22,
        "fixed": 0,
        "variable": 926.22,
        "net": 9073.78,
        "cpm": 0.19,
        "ppm": 1.81,
        "statementExpenses": 895.72,
        "buckets": [
          [
            "Tolls",
            926.22
          ]
        ],
        "ledgerCounted": 926.22,
        "ledgerRows": 7,
        "bridgeDifference": 0,
        "crossChecks": 0
      },
      "rows": [
        [
          "T1",
          926.22,
          9073.78
        ]
      ]
    },
    "6M": {
      "kpi": {
        "gross": 12000,
        "expenses": 926.47,
        "fixed": 0,
        "variable": 926.47,
        "net": 11073.53,
        "cpm": 0.15,
        "ppm": 1.85,
        "statementExpenses": 895.97,
        "buckets": [
          [
            "Tolls",
            926.47
          ]
        ],
        "ledgerCounted": 926.47,
        "ledgerRows": 8,
        "bridgeDifference": 0,
        "crossChecks": 0
      },
      "rows": [
        [
          "T1",
          926.47,
          11073.53
        ]
      ]
    },
    "yearly": {
      "kpi": {
        "gross": 12000,
        "expenses": 926.47,
        "fixed": 0,
        "variable": 926.47,
        "net": 11073.53,
        "cpm": 0.15,
        "ppm": 1.85,
        "statementExpenses": 895.97,
        "buckets": [
          [
            "Tolls",
            926.47
          ]
        ],
        "ledgerCounted": 926.47,
        "ledgerRows": 8,
        "bridgeDifference": 0,
        "crossChecks": 0
      },
      "rows": [
        [
          "T1",
          926.47,
          11073.53
        ]
      ]
    }
  },
  "comparison": [
    [
      "T1",
      926.47,
      11073.53
    ]
  ],
  "weekly": [
    [
      "2026-08-07",
      2000,
      1999.75
    ],
    [
      "2026-08-21",
      2000,
      1999.75
    ],
    [
      "2026-09-04",
      2000,
      1967.75
    ],
    [
      "2026-09-18",
      2000,
      1544.31
    ],
    [
      "2026-10-02",
      2000,
      1747.5
    ],
    [
      "2026-10-16",
      2000,
      1812.97
    ]
  ],
  "profitAnalysis": [
    12000,
    926.47,
    11073.53
  ],
  "trueProfit": 11073.53
};

test('T1: owner toll data on statement-backed weeks — every profit figure as recorded before the change', () => {
  expect(ownerSnapshot()).toEqual(BEFORE);
});
