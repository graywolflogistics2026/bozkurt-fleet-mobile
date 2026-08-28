-- docs/PENDING_SQL.md §73 — EQUIPMENT AUTO-POPULATE FROM IMPORTS (owner
-- decision, SIMPLIFICATION PASS, item 7, binding). A settlement or
-- standalone purchase deduction line landing in a durable-goods category
-- (EQUIPMENT_TYPE_CATEGORIES, app/src/import/category.ts — Tools &
-- Equipment / Truck Supplies & Equipment / Electronics / Comfort &
-- Sleeper / Safety Gear & Workwear) also gets a linked Equipment row now
-- (app/src/data/aiImportSave.ts's maybeLinkEquipment()) — the same item
-- appears once in Deductions as the expense and once in Equipment as the
-- tracked asset, linked by id, mirroring the existing
-- capital_transactions.linked_deduction_id pattern for personally-paid
-- expenses <-> capital contributions.

-- linked_deduction_id: `on delete cascade` (not `set null`) — this is the
-- deliberate, chosen half of the bidirectional-delete requirement:
-- deleting the DEDUCTION removes its linked Equipment row automatically,
-- at the DB level, zero app code needed, exactly mirroring
-- capital_transactions.linked_deduction_id's own established convention.
-- The REVERSE direction (deleting the EQUIPMENT row also removes its
-- linked deduction) has no equivalent DB-level mechanism — a deduction
-- row has no FK pointing at equipment for a trigger-free cascade to hang
-- off of — so it's handled explicitly in app code instead
-- (app/(tabs)/more/equipment.tsx's own delete handler now also deletes
-- the linked deduction, best-effort documented in that file), the same
-- "some cascades are DB-level, some are explicit app-level calls, chosen
-- per direction" pattern this codebase already uses elsewhere (e.g.
-- cleanupOrphanedDocument()'s own explicit re-check-then-delete, rather
-- than a blanket DB trigger, for orphaned Storage files).
alter table equipment add column if not exists linked_deduction_id uuid references deductions(id) on delete cascade;

-- vendor: mirrors deductions.store — no existing column served this
-- purpose (name is the item's own description, not who it was bought
-- from).
alter table equipment add column if not exists vendor text;

create index if not exists idx_equipment_linked_deduction_id on equipment(linked_deduction_id) where linked_deduction_id is not null;
