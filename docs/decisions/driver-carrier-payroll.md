# Carrier payroll drivers (owner decision 2026-11-13, §88)

Approved: `driver-design.md` (owner's Desktop) plus the owner's 9 points of
2026-11-13, which override the file where they differ.

## What happens on import
- A **Prime** week (carrier isolation) whose settlement prints a **WAGE
  EXPENSE** section pays a W-2 driver through Prime's payroll:
  `DF F.I.C.A. FOR BOZKME`, `DU F.U.T.A./S.U.T.A.`, `WC WORK COMP COST`,
  `WD WAGES PAID FOR`, `2S Emp Driver Wellness Bnf`, `TOTAL WAGE EXPENSE`.
- `carrierPayrollOf()` (`app/src/import/carrierPayroll.ts`): a driver exists
  only where a **WD** line ends in a code. Never from fuel lines (BOZKME is
  printed there too), never from `settlement.driverName`, so never the owner.
  A wage line read without its code belongs to the week's only driver.
- Per week and driver: wages = WD + 2S, employer taxes = DF + DU, work comp
  = WC, total = the printed TOTAL WAGE EXPENSE (one driver) else the sum of
  that driver's lines. A line-sum difference never blocks (gate unchanged).
- `saveCarrierPayroll()` (`app/src/data/carrierPayrollSave.ts`), a separate
  non-fatal write after the settlement row: find or create the driver by
  (user, carrier, code) — `w2_employee`, `paid_via_carrier_payroll` — and
  insert one `driver_payments` row (`source 'settlement'`, `work_comp`,
  `total_cost`). Re-import replaces the settlement's rows (existing cleanup).
  It reads the extraction, so it works when line rows were not saved.
- "+ TEAM" on a revenue line -> `settlements.team_week` (label only).

## The name
- Printed on the DRIVERS PAYROLL RECAP pages ("EMPLOYEE: BOZKME MERVE
  BOZKURT"), which come after the statement, so they are already read by
  the existing best-effort attachment call (claude-haiku-5-5, one page per
  call). The attachment prompt/schema gained kind `payroll_recap` with
  `payroll.employees[{code,name}]` — never pay figures, hours or bank
  numbers. No extra call, no Opus tokens; a few more output tokens per
  recap page (well under 1/100 of a cent per statement).
- Attachments run after the card appears. If the owner certifies before
  the recap page was read, or for the two backfilled weeks, the driver's
  name is its code and the Drivers screen asks "Who is BOZKME?" once. The
  next imported week fills a code-name automatically; a name the owner
  typed is never replaced.

## Attribution only (no double count)
- The wage lines are already WAGES expenses inside the statement's profit.
  `isCarrierPayrollPayment()` keeps `source 'settlement'` rows out of
  `sumDeductibleDriverPayroll()` (tax estimate), `calcContractLaborYtd()`
  (1099 reminder) and `buildTruckComparison()` (Per-Truck). Carrier-payroll
  drivers get no manual payment sheet (no app FICA) and are excluded from
  the import screen's driver match and picker (no payroll routing).
- `driverCarrierPayroll18.test.ts`: 18 golden weeks saved; only 11/06 and
  11/13 get rows; Home 88,210.06 / 41,977.33 / 46,232.73 / 39,913.01 and
  every other table identical to a save without the attribution.

## Drivers screen
Name (or "Who is <code>?"), code, "W-2 via Prime", Team/Solo (latest paid
week), latest week and year-to-date wages, employer taxes, work comp,
total, paid weeks. No SSN, bank or W-4 fields.
