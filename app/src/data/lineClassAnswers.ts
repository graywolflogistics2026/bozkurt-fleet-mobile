import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { missingColumnIn, OPTIONAL_TRUCK_COLUMNS, updateRowTolerant } from '@/src/data/fleetEdit';
import { asTruckOwnership, type ResolvedClass, type TruckOwnership } from '@/src/import/lineClass';

// The review card's one-time answers (owner decisions D10/D11 2026-11-03,
// docs/decisions/prime-code-classes.md). Each answer is stored where Save
// reads it, so it is asked once and used on every later import:
// - the truck's ownership -> trucks.ownership (§84);
// - an unclassed code's class -> category_learning_rules.economic_class,
//   scoped to the statement's carrier and this user (§84).
// Before §84 runs, both columns are missing: the answer is not stored and
// the caller says so (NeedsDatabaseUpdateError), never a crash.

export class NeedsDatabaseUpdateError extends Error {
  constructor() {
    super('needs_db');
    this.name = 'NeedsDatabaseUpdateError';
  }
}

export async function saveTruckOwnership(truckId: string, ownership: TruckOwnership): Promise<void> {
  const r = await updateRowTolerant('trucks', truckId, { ownership }, OPTIONAL_TRUCK_COLUMNS);
  if (r.skippedColumns.includes('ownership')) throw new NeedsDatabaseUpdateError();
}

export async function rememberLineClass(args: {
  userId: string;
  carrier: string;
  keyword: string;
  category: string | null;
  economicClass: ResolvedClass;
}): Promise<void> {
  const { userId, carrier, keyword, economicClass } = args;
  const found = await supabase
    .from('category_learning_rules')
    .select('id')
    .eq('user_id', userId)
    .eq('keyword', keyword)
    .eq('carrier', carrier)
    .maybeSingle();
  if (found.error) throw found.error;
  const res = found.data
    ? await supabase.from('category_learning_rules').update({ economic_class: economicClass }).eq('id', found.data.id as string)
    : await supabase
        .from('category_learning_rules')
        .insert({ user_id: userId, keyword, category: args.category || 'Misc', hit_count: 1, carrier, economic_class: economicClass });
  if (res.error) {
    if (missingColumnIn(res.error, ['economic_class'])) throw new NeedsDatabaseUpdateError();
    throw res.error;
  }
}

// trucks.ownership for the review card, read on its own (never added to the
// startup truck select: before §84 an unknown column there would fail the
// whole truck list). Missing column or no truck -> null (asked once).
export function useTruckOwnership(truckId: string | null) {
  return useQuery<TruckOwnership | null>({
    queryKey: ['trucks', 'ownership', truckId],
    enabled: !!truckId,
    queryFn: async () => {
      const { data, error } = await supabase.from('trucks').select('ownership').eq('id', truckId as string).maybeSingle();
      if (error || !data) return null;
      return asTruckOwnership((data as { ownership?: unknown }).ownership);
    },
  });
}
