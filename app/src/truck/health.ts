// Truck Health calculation engine — verbatim port of legacy rHealth()/
// applyMaintToHealth() (legacy/index.html:1717,1886), generalized to read
// per-truck maintenance_intervals rows instead of hardcoded constants
// (owner decision 2026-07-03 — CLAUDE.md invariant #4). Deliberately a
// pure, unit-tested TypeScript module rather than the `truck_health` SQL
// view already present in supabase/migrations/0001_init.sql — every other
// calculation in this app (CPM, per diem, tax estimate, driver payroll)
// lives here as testable app code, and a SQL view can't be exercised by
// this project's Jest setup. The view stays in the schema unused; this
// module is the single source of truth for what the Truck Health screen
// renders.

export type TrackingMode = 'miles' | 'hours' | 'mpg_based';
export type HealthStatus = 'overdue' | 'due_soon' | 'ok' | 'no_data';

export type HealthIntervalInput = {
  category: string;
  trackingMode: TrackingMode;
  intervalMiles: number | null;
  intervalHours: number | null;
  bundledWithCategory: string | null;
  enabled: boolean;
};

export type MaintenanceRecordInput = {
  serviceType: string | null;
  odometer: number | null;
  engineHours: number | null;
  serviceDate: string | null;
};

// Manual baseline overrides (truck_health_config.overrides) — used ONLY
// when no maintenance_records row exists for a category (own or bundled),
// same fallback order as the SQL view. No editing UI for this ships this
// pass (PROMPTS.md Session 8 empty-state decision — see health.test.ts and
// PROMPTS.md); reading it here keeps the door open for a future screen to
// set one without any calc-engine change.
export type HealthOverrides = Record<string, { odometer?: number; hours?: number }>;

export type HealthResult = {
  category: string;
  trackingMode: TrackingMode;
  intervalMiles: number | null;
  intervalHours: number | null;
  baselineOdometer: number;
  baselineHours: number;
  lastDoneDate: string | null;
  remaining: number;
  nextDue: number; // odometer (miles mode) or hours (hours mode) at which this category is next due
  status: HealthStatus;
};

type Baseline = { maxOdometer: number; maxHours: number; date: string | null };

// Highest-odometer/hours-wins per service type, across ALL maintenance
// records for that type — mirrors legacy's "Uses the highest known
// odometer per service type so history stays consistent no matter what
// order records are imported/added in" (legacy/index.html:1709). The date
// carried through is the date of whichever record set the max (ties keep
// the first one seen), not necessarily the most recently-added record.
function buildBaselines(records: MaintenanceRecordInput[]): Map<string, Baseline> {
  const baselines = new Map<string, Baseline>();
  for (const rec of records) {
    if (!rec.serviceType) continue;
    const odo = rec.odometer ?? 0;
    const hrs = rec.engineHours ?? 0;
    const existing = baselines.get(rec.serviceType);
    if (!existing) {
      baselines.set(rec.serviceType, { maxOdometer: odo, maxHours: hrs, date: rec.serviceDate });
      continue;
    }
    if (odo > existing.maxOdometer) {
      existing.maxOdometer = odo;
      existing.date = rec.serviceDate;
    }
    if (hrs > existing.maxHours) {
      existing.maxHours = hrs;
      if (odo <= existing.maxOdometer) existing.date = existing.date ?? rec.serviceDate;
    }
  }
  return baselines;
}

// legacy's fixed 10% warn threshold for mileage categories
// (`w=Math.round(IV*0.1)`) and 200-hour threshold for APU
// (`st('h-apu',apu,200,...)`) — both ported verbatim, not re-tuned.
const MILES_WARN_FRACTION = 0.1;
const HOURS_WARN_THRESHOLD = 200;

export function calcTruckHealth(
  intervals: HealthIntervalInput[],
  maintenanceRecords: MaintenanceRecordInput[],
  currentOdometer: number,
  currentApuHours: number,
  overrides: HealthOverrides = {}
): HealthResult[] {
  const baselines = buildBaselines(maintenanceRecords);

  return intervals
    .filter((iv) => iv.enabled)
    .map((iv) => {
      const own = baselines.get(iv.category);
      const bundle = iv.bundledWithCategory ? baselines.get(iv.bundledWithCategory) : undefined;
      const overrideEntry = overrides[iv.category];

      // Bundled cascade (e.g. 'fuel' inherits 'oil's baseline when fuel
      // itself was never separately logged) — own record wins if it's
      // actually higher, same "highest wins" rule applied across sources.
      const baselineOdometer = Math.max(own?.maxOdometer ?? 0, bundle?.maxOdometer ?? 0, overrideEntry?.odometer ?? 0);
      const baselineHours = Math.max(own?.maxHours ?? 0, overrideEntry?.hours ?? 0);
      const lastDoneDate =
        (own && own.maxOdometer === baselineOdometer && own.maxOdometer > 0 ? own.date : null) ??
        (bundle && bundle.maxOdometer === baselineOdometer && bundle.maxOdometer > 0 ? bundle.date : null);

      const hasBaseline = baselineOdometer > 0 || baselineHours > 0;
      const isHours = iv.trackingMode === 'hours';
      const interval = isHours ? (iv.intervalHours ?? 0) : (iv.intervalMiles ?? 0);
      const consumed = isHours ? currentApuHours - baselineHours : currentOdometer - baselineOdometer;
      const remaining = interval - consumed;
      const nextDue = isHours ? baselineHours + interval : baselineOdometer + interval;

      let status: HealthStatus;
      if (!hasBaseline) {
        status = 'no_data';
      } else if (remaining < 0) {
        status = 'overdue';
      } else if (isHours) {
        status = remaining < HOURS_WARN_THRESHOLD ? 'due_soon' : 'ok';
      } else {
        status = remaining < interval * MILES_WARN_FRACTION ? 'due_soon' : 'ok';
      }

      return {
        category: iv.category,
        trackingMode: iv.trackingMode,
        intervalMiles: iv.intervalMiles,
        intervalHours: iv.intervalHours,
        baselineOdometer,
        baselineHours,
        lastDoneDate,
        remaining,
        nextDue,
        status,
      };
    });
}
