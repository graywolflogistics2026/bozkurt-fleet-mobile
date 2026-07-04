-- ============================================================================
-- Bozkurt Fleet OS — Dev seed data
-- LOCAL / DEV SUPABASE INSTANCE ONLY. Never run against a production project
-- — it inserts a row directly into auth.users with a known password.
--
-- Creates:
--   1. One dev auth user (dev@graywolflogistics.test / devpassword123)
--   2. Unit 830157 (2023 International LT, A26 12.4L) for that user — this
--      INSERT fires trg_seed_maintenance_intervals (0001_init.sql), which
--      seeds all 12 maintenance_intervals rows automatically; nothing further
--      needed here for that table.
--   3. The 56-row curated Prime Inc. Report 140A repair history for Unit
--      830157 (PRIME_HISTORY_830157 in legacy/index.html — washes, detailing,
--      direct-sale pickups and inspection-only/no-action entries already
--      excluded there, so all 56 rows here are real service events).
-- Idempotent: safe to run this file multiple times against the same database.
-- ============================================================================

-- 1. Dev user — fixed UUID so later inserts can reference it directly without
--    a data-modifying CTE. `raw_app_meta_data`/`raw_user_meta_data` mirror
--    what GoTrue (Supabase Auth) sets for a normal email/password signup, so
--    the row behaves like a real signed-up user, including firing
--    trg_handle_new_user to create its profiles row.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'dev@graywolflogistics.test',
  crypt('devpassword123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{}'
)
on conflict (id) do nothing;

-- Belt-and-suspenders in case trg_handle_new_user didn't fire (e.g. this file
-- is re-run after the user already existed from a prior run).
insert into public.profiles (user_id, owner_name)
values ('00000000-0000-0000-0000-000000000001', 'Ali Bozkurt')
on conflict (user_id) do nothing;

-- 2. Unit 830157 — fixed UUID for the same reason as the dev user above.
--    current_odometer/apu_hours match the truck's real last-known readings
--    from legacy/index.html (Truck Health page placeholders / rHealth()
--    fallback constants); fleet_mpg 8.9 matches the legacy default, which
--    resolves the DPF interval to the 600,000 mi tier via
--    seed_maintenance_intervals().
insert into trucks (
  id, user_id, unit_number, vin, year, make, model, engine,
  current_odometer, fleet_mpg, apu_hours, is_active
) values (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  '830157', '3HSDZTZR4PN135369', 2023, 'International', 'LT', 'A26 12.4L',
  304161, 8.9, 10054, true
)
on conflict (id) do nothing;

-- 3. Prime Inc. Report 140A repair history for Unit 830157 (56 rows).
--    Guarded by NOT EXISTS so re-running this file never duplicates records.
insert into maintenance_records
  (user_id, truck_id, service_date, service_type, description, odometer, vendor, invoice_number, cost)
select
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101',
  x.service_date, x.service_type, x.description, x.odometer, x.vendor, x.invoice_number, 0
from (values
  ('2023-01-19'::date, 'general',   'New truck prep/PDI — alarm, TPMS, IVG, RiteWeigh, panic button installed; bumper guard & mudflaps trimmed; 5th wheel stops, permit plates, fire ext & triangles installed', 1,      null::text,               '9266897'),
  ('2023-01-19'::date, 'general',   'APU (TriPac Evolution) & solar panel installed',                                                                       1,      null,                      '9266717'),
  ('2023-02-03'::date, 'general',   'Deer guard (Xguard) installed',                                                                                        1060,   null,                      '9308527'),
  ('2023-02-07'::date, 'brakes',    'Trailer air line repaired — hole from APU install',                                                                    1068,   null,                      '9316162'),
  ('2023-06-20'::date, 'general',   'Check engine light — fault codes checked/cleared',                                                                     35537,  null,                      '9656927'),
  ('2023-06-25'::date, 'chassis',   'Chassis lube — 5th wheel & 7-way greased',                                                                             36750,  null,                      '9671014'),
  ('2023-07-17'::date, 'general',   'Roadside coolant leak repair',                                                                                         45192,  'Barnett''s Wrecker',      '9731247'),
  ('2023-09-12'::date, 'tires',     'Tire replaced — worn below DOT spec (roadside)',                                                                       57703,  'Michelin',                '9971462'),
  ('2023-11-04'::date, 'oil',       'Oil change (PM service) — combined with APU service',                                                                  71363,  null,                      '147845'),
  ('2023-11-04'::date, 'general',   'Power steering tank clamp replaced — leaking',                                                                         71363,  null,                      '147845'),
  ('2023-11-22'::date, 'general',   'Annual DOT Inspection — FAILED (seat belt cut, PS hose leak, deck plate drag)',                                        76492,  null,                      '231009'),
  ('2023-11-23'::date, 'brakes',    '3-in-1 trailer air line & spring hanger replaced; PS hose tightened',                                                  76499,  null,                      '233111'),
  ('2024-01-12'::date, 'brakes',    'Red air line replaced (roadside)',                                                                                     95250,  null,                      '397522'),
  ('2024-01-23'::date, 'airfilter', 'Engine air filter replaced (roadside)',                                                                                99429,  null,                      '438795'),
  ('2024-02-20'::date, 'general',   'Fuel pump (HPFP) replaced — warranty',                                                                                 107033, null,                      '538176'),
  ('2024-02-20'::date, 'general',   'Rear suspension height-leveling valve/bracket replaced',                                                               107033, null,                      '538176'),
  ('2024-03-13'::date, 'chassis',   'Chassis lube',                                                                                                         111744, null,                      '611079'),
  ('2024-04-22'::date, 'fuel',      'Fuel filters replaced (primary & secondary) — waxing found, CEL fault',                                                125915, 'Rush Truck Center',       '747644'),
  ('2024-04-24'::date, 'general',   'Leaf spring bushings replaced (LRD/RRD) — warranty',                                                                   125980, null,                      '754740'),
  ('2024-04-25'::date, 'general',   'Front axle alignment — warranty',                                                                                      125982, null,                      '757468'),
  ('2024-07-19'::date, 'oil',       'Oil change (PM service)',                                                                                              150049, 'Love''s #243',            '1064079'),
  ('2024-10-28'::date, 'general',   'Annual DOT Inspection — passed',                                                                                       179605, null,                      '1417043'),
  ('2024-11-22'::date, 'chassis',   'Chassis lube — all fittings, 5th wheel, drive axle',                                                                   187904, null,                      '1496950'),
  ('2025-01-13'::date, 'airfilter', 'Engine air filter replaced + brake switch (warranty)',                                                                 200316, null,                      '1662873'),
  ('2025-03-11'::date, 'airdryer',  'Air dryer cartridge replaced (PM)',                                                                                    214905, 'Love''s #490',            '1846887'),
  ('2025-05-13'::date, 'oil',       'Oil change (PM service) + chassis lube',                                                                               230032, 'Love''s #380',            '2052797'),
  ('2025-05-13'::date, 'chassis',   'Chassis lube (same visit as oil change PM)',                                                                           230032, 'Love''s #380',            '2052797b'),
  ('2025-06-30'::date, 'general',   'Bumper support repaired (damage); marker light replaced; specs checked',                                               247705, null,                      '2217303'),
  ('2025-07-28'::date, 'def',       'DEF filter replaced (PM); alarm keypad replaced',                                                                      256099, null,                      '2312077'),
  ('2025-09-14'::date, 'chassis',   'Chassis lube (PM)',                                                                                                    267706, null,                      '2482565'),
  ('2025-09-23'::date, 'tires',     'Both steer tires replaced — DOT shutdown (roadside)',                                                                  272312, 'Michelin',                '2513574'),
  ('2025-09-24'::date, 'brakes',    'Air leak from distribution valve repaired; slack adjuster replaced',                                                   273069, 'TA-Denver East',          '2520210'),
  ('2025-09-26'::date, 'tires',     'Both rear drive tires replaced — irregular wear',                                                                      273550, null,                      '2525787'),
  ('2025-10-26'::date, 'general',   'Annual DOT Inspection — passed',                                                                                       284045, 'TA Baytown',              '2630608'),
  ('2025-11-13'::date, 'general',   'Roadside — battery/cranking system check (all good)',                                                                  284551, 'Love''s #639',            '2690064'),
  ('2025-11-18'::date, 'general',   '⚠️ Major breakdown — truck shut down, would not restart. Towed to dealer, driveline (drive shaft) installed',           285964, 'Rush Truck International', '2705939'),
  ('2026-01-14'::date, 'tires',     'LF tire replaced — cords showing; taillight wire spliced (roadside)',                                                  296276, 'Michelin',                '2898104'),
  ('2026-01-18'::date, 'tires',     'RF tire replaced — blowout (roadside)',                                                                                297798, 'Michelin',                '2910887'),
  ('2026-02-04'::date, 'general',   'Comprehensive warranty inspection & repairs — cab shocks (x2), door window switch, lighting, window seals, hood struts, mirror, seat hardware', 304118, null, '2978655'),
  ('2026-02-04'::date, 'general',   'Cabin fresh air filters (x3) replaced; air intake housing bolt/hose re-secured (not a filter element change)',         304118, null,                      '2978502'),
  ('2026-02-04'::date, 'brakes',    'Brake glad hand seals & trailer air lines (3-in-1) replaced',                                                           304118, null,                      '2978655b'),
  ('2026-02-04'::date, 'chassis',   '5th wheel lubed (Top Off Fluids service — 2qts engine oil, 3qts gear oil also topped off)',                             304118, null,                      '2978655c'),
  ('2026-02-10'::date, 'oil',       'Oil change (PM service)',                                                                                              304129, null,                      '3001925'),
  ('2026-02-11'::date, 'general',   '⚠️ Engine oil leak repaired — right/left side, oil pan, oil fill tube',                                                 304129, 'Rush Truck Center',       '3002554'),
  ('2026-02-25'::date, 'tires',     'Roadside tire service',                                                                                                 304143, null,                      '3051496'),
  ('2026-03-02'::date, 'tires',     'Drive tires rotated',                                                                                                   304143, null,                      '3069194'),
  ('2026-03-13'::date, 'brakes',    'Wheel studs replaced (all positions); drive brake shoes & drums replaced — worn beyond spec',                           304157, 'Pedigree Sale Prep',      '3110731'),
  ('2026-05-19'::date, 'general',   'Annual DOT Inspection — passed',                                                                                        304159, null,                      '3350432a'),
  ('2026-05-19'::date, 'dpf',       'DPF cleaning performed (PM)',                                                                                           304159, null,                      '3350432b'),
  ('2026-05-19'::date, 'general',   'Both engine belts replaced',                                                                                            304159, null,                      '3350432c'),
  ('2026-05-19'::date, 'brakes',    'Steer brakes & drums replaced — worn/grooved',                                                                          304159, null,                      '3350432d'),
  ('2026-05-19'::date, 'general',   'Front grill damaged in prior incident — ordered for replacement; window seal repaired',                                 304159, null,                      '3350432e'),
  ('2026-05-19'::date, 'airfilter', 'Engine air filter replaced (PM)',                                                                                       304159, null,                      '3350432f'),
  ('2026-05-20'::date, 'general',   '⚠️ Accident body/paint repair — fenders, rocker panels, cab extenders, fairings, decals replaced',                      304160, 'Eolers Body Shop',        '3355417'),
  ('2026-05-21'::date, 'general',   'Front grill replaced',                                                                                                  304160, null,                      '3360090'),
  ('2026-05-26'::date, 'general',   'Interior body repair — damaged panel holes repaired',                                                                   304161, null,                      '3375582')
) as x(service_date, service_type, description, odometer, vendor, invoice_number)
where not exists (
  select 1 from maintenance_records
  where truck_id = '00000000-0000-0000-0000-000000000101'
);
