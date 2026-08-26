import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { withTimeout } from '@/src/lib/withTimeout';

const STARTUP_TIMEOUT_MS = 8000;
// AsyncStorage can't hold `null` as a value — this sentinel represents the
// "All Trucks" scope in the persisted string (see MULTI-TRUCK MODEL below).
const ALL_TRUCKS_SENTINEL = 'all';

export type Truck = {
  id: string;
  unit_number: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  fleet_mpg: number | null;
  is_active: boolean;
  purchase_price: number | null;
  // docs/PENDING_SQL.md §44 (owner decision 2026-08-05) — a user-entered
  // odometer/ELD total that supersedes calcMiles()'s own calculated
  // total for CPM/RPM. null = not set.
  manual_total_miles_override: number | null;
  // docs/PENDING_SQL.md §45 (owner decision 2026-08-05) — see
  // app/src/stats/truckCostBasis.ts.
  cost_basis_ownership_mode: 'paid' | 'loan' | 'lease' | null;
  cost_basis_loan_monthly_payment: number | null;
  cost_basis_paid_spread_months: number | null;
  cost_basis_warranty_cost: number | null;
  cost_basis_warranty_term_months: number | null;
};

// MULTI-TRUCK MODEL (owner decision) — this context is now the ONE global
// scope every screen reads: `activeTruckId === null` means either "no
// trucks exist yet" (trucks.length === 0, unchanged from before) OR the
// user has explicitly selected "All Trucks" (trucks.length > 1) —
// disambiguated by `isAllTrucks` below. Previously a multi-truck account
// with no stored preference silently defaulted to `trucks[0]`; it now
// defaults to "All Trucks" (owner decision, requirement 1's "All Trucks
// (default)"), and every truck-scoped query/screen in the app already had
// to tolerate `activeTruck === null` (the pre-existing zero-trucks case),
// so this is a real default-behavior change with a already-proven-safe
// fallback shape at every call site — no screen crashes on null, though
// several were audited/adjusted this pass to show a genuinely useful
// fleet-wide or per-truck-breakdown view instead of just going quiet (see
// CLAUDE.md's MULTI-TRUCK MODEL entry). `setActiveTruckId('all')` is the
// explicit way to select fleet-wide scope; any other string selects that
// truck. Single-truck accounts (trucks.length === 1) are unaffected —
// there is no "All Trucks" vs "Unit X" distinction to make when there's
// only one truck (CLAUDE.md invariant #7's own n=1 shortcut).
type ActiveTruckContextValue = {
  trucks: Truck[];
  activeTruckId: string | null;
  activeTruck: Truck | null;
  // true when trucks.length > 1 and the user is currently viewing "All
  // Trucks" (activeTruckId === null with 2+ trucks on the account) —
  // distinct from activeTruckId === null with ZERO trucks, which means
  // there is no fleet to scope at all.
  isAllTrucks: boolean;
  showPicker: boolean; // false when count <= 1 (CLAUDE.md invariant #7)
  loading: boolean;
  setActiveTruckId: (id: string | 'all') => void;
  refreshTrucks: () => Promise<void>;
};

const ActiveTruckContext = createContext<ActiveTruckContextValue | undefined>(undefined);

function storageKey(userId: string) {
  return `active-truck:${userId}`;
}

export function ActiveTruckProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [activeTruckId, setActiveTruckIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshTrucks() {
    if (!session) {
      setTrucks([]);
      setActiveTruckIdState(null);
      return;
    }
    setLoading(true);
    try {
      const result = await withTimeout(
        supabase
          .from('trucks')
          .select(
            'id, unit_number, vin, year, make, model, fleet_mpg, is_active, purchase_price, manual_total_miles_override, cost_basis_ownership_mode, cost_basis_loan_monthly_payment, cost_basis_paid_spread_months, cost_basis_warranty_cost, cost_basis_warranty_term_months'
          )
          .eq('is_active', true)
          .order('created_at', { ascending: true }),
        STARTUP_TIMEOUT_MS,
        'trucks fetch'
      );

      const list = result?.data ?? [];
      setTrucks(list);

      const stored = await withTimeout(
        AsyncStorage.getItem(storageKey(session.user.id)),
        STARTUP_TIMEOUT_MS,
        'active-truck AsyncStorage read'
      );

      if (stored === ALL_TRUCKS_SENTINEL && list.length > 1) {
        setActiveTruckIdState(null);
        return;
      }
      const storedStillValid = list.some((t) => t.id === stored);

      if (storedStillValid) {
        setActiveTruckIdState(stored);
      } else if (list.length === 1) {
        // n=1 shortcut (CLAUDE.md invariant #7) — no "All Trucks" choice
        // to make, always the one truck.
        setActiveTruckIdState(list[0].id);
        await AsyncStorage.setItem(storageKey(session.user.id), list[0].id);
      } else if (list.length > 1) {
        // NEW DEFAULT (owner decision, MULTI-TRUCK MODEL): "All Trucks",
        // not trucks[0] — a fresh multi-truck account, or one whose stored
        // preference no longer resolves, opens fleet-wide.
        setActiveTruckIdState(null);
        await AsyncStorage.setItem(storageKey(session.user.id), ALL_TRUCKS_SENTINEL);
      } else {
        setActiveTruckIdState(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshTrucks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  function setActiveTruckId(id: string | 'all') {
    if (id === ALL_TRUCKS_SENTINEL) {
      setActiveTruckIdState(null);
    } else {
      setActiveTruckIdState(id);
    }
    if (session) AsyncStorage.setItem(storageKey(session.user.id), id);
  }

  const activeTruck = useMemo(
    () => trucks.find((t) => t.id === activeTruckId) ?? null,
    [trucks, activeTruckId]
  );

  const value: ActiveTruckContextValue = {
    trucks,
    activeTruckId,
    activeTruck,
    isAllTrucks: trucks.length > 1 && activeTruckId === null,
    showPicker: trucks.length > 1,
    loading,
    setActiveTruckId,
    refreshTrucks,
  };

  return <ActiveTruckContext.Provider value={value}>{children}</ActiveTruckContext.Provider>;
}

export function useActiveTruck() {
  const ctx = useContext(ActiveTruckContext);
  if (!ctx) throw new Error('useActiveTruck must be used within ActiveTruckProvider');
  return ctx;
}
