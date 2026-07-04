import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';

export type Truck = {
  id: string;
  unit_number: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  is_active: boolean;
};

type ActiveTruckContextValue = {
  trucks: Truck[];
  activeTruckId: string | null;
  activeTruck: Truck | null;
  showPicker: boolean; // false when count <= 1 (CLAUDE.md invariant #7)
  loading: boolean;
  setActiveTruckId: (id: string) => void;
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
    const { data } = await supabase
      .from('trucks')
      .select('id, unit_number, vin, year, make, model, is_active')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    const list = data ?? [];
    setTrucks(list);

    const stored = await AsyncStorage.getItem(storageKey(session.user.id));
    const storedStillValid = list.some((t) => t.id === stored);

    if (storedStillValid) {
      setActiveTruckIdState(stored);
    } else if (list.length > 0) {
      setActiveTruckIdState(list[0].id);
      await AsyncStorage.setItem(storageKey(session.user.id), list[0].id);
    } else {
      setActiveTruckIdState(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    refreshTrucks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  function setActiveTruckId(id: string) {
    setActiveTruckIdState(id);
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
