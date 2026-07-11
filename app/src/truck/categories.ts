// The 12 health-tracked maintenance categories — exact seed order/values
// from seed_maintenance_intervals() (supabase/migrations/0001_init.sql),
// itself a verbatim port of legacy's MAINT_HEALTH_MAP + APU handling
// (legacy/index.html:1537,1902). Icons are locale-independent; labels go
// through i18n (`truckHealth.categories.<category>`), same
// useDocTypeMeta()-style split as every other icon+label pairing in this
// app (CLAUDE.md invariant #11).
export const HEALTH_CATEGORIES = [
  'oil',
  'fuel',
  'dpf',
  'def',
  'coolant_ext',
  'coolant',
  'trans',
  'diff',
  'airfilter',
  'airdryer',
  'chassis',
  'apu',
] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

export const HEALTH_CATEGORY_ICON: Record<HealthCategory, string> = {
  oil: '🛢️',
  fuel: '⛽',
  dpf: '💨',
  def: '🧪',
  coolant_ext: '❄️',
  coolant: '💧',
  trans: '🔧',
  diff: '⚙️',
  airfilter: '🌬️',
  airdryer: '🌀',
  chassis: '🔩',
  apu: '🔋',
};

// Maintenance log service types — the 12 health categories above PLUS
// loggable-but-not-health-tracked types (legacy MAINT_TYPE_LABELS,
// legacy/index.html:1536 — valve/tires/brakes have no interval concept in
// legacy either, general/other are manual catch-alls). Matches
// app/src/import/category.ts detectMaintType()'s vocabulary exactly (post
// toDbServiceType() normalization: 'coolext' -> 'coolant_ext').
export const MAINTENANCE_TYPES = [...HEALTH_CATEGORIES, 'valve', 'tires', 'brakes', 'general', 'other'] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_TYPE_ICON: Record<MaintenanceType, string> = {
  ...HEALTH_CATEGORY_ICON,
  valve: '⚙️',
  tires: '🛞',
  brakes: '🛑',
  general: '🔩',
  other: '📄',
};
