// Verbatim ports from legacy/index.html — do not "clean up" the regexes,
// they encode months of real-receipt tuning (see CLAUDE.md: port battle-
// tuned logic verbatim).

// legacy/index.html:994 — payment methods meaning "paid from the owner's
// own personal money", not the business account/card. Triggers the
// Capital Account contribution rule (CLAUDE.md invariant #2).
export function isPersonalPayment(payment: string | undefined | null): boolean {
  return /personal|cash|zelle|venmo/i.test(payment ?? '');
}

const STORE_CATS: Record<string, string | null> = {
  amazon: null,
  walmart: 'Misc',
  'home depot': 'Truck Supplies',
  lowes: 'Truck Supplies',
  'harbor freight': 'Tools & Equipment',
  autozone: 'Tools & Equipment',
  oreilly: 'Tools & Equipment',
  napa: 'Tools & Equipment',
};

// legacy/index.html:2474 guessCategory()
export function guessCategory(name: string | undefined, store: string | undefined): string {
  const n = (name ?? '').toLowerCase();
  const s = (store ?? '').toLowerCase();
  const combined = n + ' ' + s;

  if (
    /legal|attorney|lawyer|llc filing|llc formation|registered agent|secretary of state|accountant|accounting|bookkeep|abacus|tax prep|cpa\b/.test(
      combined
    )
  )
    return 'Legal & Accounting Fees';
  if (
    /anthropic|claude|openai|chatgpt|api credit|github|google workspace|gsuite|dropbox|icloud|microsoft 365|office 365|subscription|saas|software license|trucker path|motive|keeptruckin|samsara|eld\b|garmin|rand mcnally|hammer.?maps?|maps? (subscription|purchase|app)|gps (app|subscription)|dat load|truckstop\.com|load board/.test(
      combined
    )
  )
    return 'Software & Subscriptions';
  if (/insurance|premium|policy/.test(combined)) return 'Insurance';
  if (/permit|license|licensing|dot number|mc number|ifta|irp/.test(combined)) return 'Licensing & Permits';
  if (
    /drill|saw|wrench|socket|screwdriver|hammer|plier|ratchet|impact|blower|milwaukee|dewalt|ryobi|makita|bosch|craftsman|combo kit|power tool|torque|grease|jack|lift|air compressor|generator|m18|m12|fuel kit/.test(
      n
    )
  )
    return 'Tools & Equipment';
  if (
    /fridge|cooler|refrigerator|microwave|coffee|keurig|fan|heater|curtain|pillow|blanket|mattress|bunk|seat cover|bedding|tv|television|playstation|xbox|nintendo|gaming|console|game|ps4|ps5|roku|firestick|air fryer|instant pot|rice cooker|hot plate|electric kettle|toaster|cooking|cookware|pot|pan|skillet|organizer|storage/.test(
      n
    )
  )
    return 'Comfort & Sleeper';
  if (
    /camera|cam|dash|gps|inverter|charger|outlet|tablet|phone mount|bluetooth|speaker|power bank|usb|surge|battery|laptop|computer|ipad|kindle|headphone|earphone|wifi|hotspot|monitor/.test(
      n
    )
  )
    return 'Electronics';
  if (
    /fire ext|reflector|triangle|vest|glove|safety|first aid|lock|chain|strap|bungee|tie down|tarp|net|rope|hook|cone/.test(
      n
    )
  )
    return 'Truck Supplies';
  if (/light|led|flashlight|lamp|work light/.test(n)) return 'Safety Equipment';
  if (/home depot|harbor freight|autozone|oreilly|napa|lowes/.test(s)) return 'Tools & Equipment';
  if (STORE_CATS[s]) return STORE_CATS[s] as string;
  return 'Misc';
}

// legacy/index.html:2497 getCatNote()
export function getCatNote(category: string): string {
  const notes: Record<string, string> = {
    'Tools & Equipment': 'Truck maintenance/repair tool',
    Electronics: 'Electronic device — truck cab',
    'Comfort & Sleeper': 'Sleeper cab equipment — OTR driver',
    'Truck Supplies': 'Truck operating supply — business expense',
    'Safety Equipment': 'Safety equipment — truck operations',
    Maintenance: 'Truck repair/maintenance expense',
    Misc: 'Business supply — OTR operations',
  };
  return notes[category] ?? 'Business expense — OTR truck driver';
}

// legacy/index.html:1636 detectMaintType()
export function detectMaintType(desc: string | undefined): string {
  const d = (desc ?? '').toLowerCase();
  if (/fuel filter/.test(d)) return 'fuel';
  if (/oil change|oil filter|engine oil|lube service/.test(d)) return 'oil';
  if (/valve lash|valve adjust/.test(d)) return 'valve';
  if (/dpf|diesel particulate|regen/.test(d)) return 'dpf';
  if (/def filter|diesel exhaust fluid filter/.test(d)) return 'def';
  if (/coolant extender|extended life coolant/.test(d)) return 'coolext';
  if (/coolant (flush|replace)|replace coolant|full coolant/.test(d)) return 'coolant';
  if (/transmission|clutch|trans fluid|trans service/.test(d)) return 'trans';
  if (/differential|diff oil|diff fluid|rear end oil|rear axle oil/.test(d)) return 'diff';
  if (/engine air filter|tractor air filter/.test(d)) return 'airfilter';
  if (/air dryer cartridge/.test(d)) return 'airdryer';
  if (/chassis lube|chassis lubrication|grease chassis|lube chassis/.test(d)) return 'chassis';
  if (/apu service|tripac service|thermo king service|apu oil/.test(d)) return 'apu';
  if (/tire|tyre/.test(d)) return 'tires';
  if (/brake/.test(d)) return 'brakes';
  return 'general';
}

// detectMaintType() returns legacy's OWN category vocabulary. The Postgres
// maintenance_intervals.category values (docs/SCHEMA.sql) are seeded with
// 'coolant_ext', not legacy's 'coolext' — the truck_health view joins
// maintenance_records.service_type to maintenance_intervals.category by
// exact string match, so inserting the unmapped 'coolext' would silently
// stop Truck Health from ever picking up a coolant-extender service logged
// through this import flow. 'tires'/'brakes' have no matching interval
// category at all (not seeded — legacy doesn't track them as a health
// category either), so they pass through unchanged and simply aren't
// tracked by Truck Health, which is correct, not a bug.
export function toDbServiceType(legacyType: string): string {
  if (legacyType === 'coolext') return 'coolant_ext';
  return legacyType;
}
