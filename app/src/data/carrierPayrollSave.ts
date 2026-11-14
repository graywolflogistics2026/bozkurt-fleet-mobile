// CARRIER PAYROLL DRIVERS — the save step (owner decision 2026-11-13, §88).
// Called by saveExtraction() after a Prime week's settlement row is saved,
// with the week's carrierPayrollOf() result: finds or creates each driver
// by (carrier, code), fills a still-missing name from the payroll recap,
// writes ONE driver_payments row per driver for this settlement, and marks
// the week's "+ TEAM" label.
//
// ATTRIBUTION ONLY: nothing here changes a profit or expense figure. The
// caller runs it as a separate, non-fatal write: before §88 adds the
// columns (or on any error) the week still saves and only the attribution
// is missing. A re-import replaces this settlement's rows: the caller
// deletes the previous driver_payments of the settlement by id after these
// inserts succeed.

import { supabase } from '@/src/lib/supabase';
import type { CarrierPayrollWeek } from '@/src/import/carrierPayroll';

export type CarrierPayrollSaveResult = { driversCreated: number; payments: number };

function fail(step: string, error: { message?: string } | null): never {
  throw new Error(`carrier payroll ${step}: ${error?.message ?? 'unknown error'}`);
}

export async function saveCarrierPayroll(params: {
  userId: string;
  settlementId: string;
  weekEnding: string;
  week: CarrierPayrollWeek;
}): Promise<CarrierPayrollSaveResult> {
  const { userId, settlementId, weekEnding, week } = params;
  let driversCreated = 0;
  let payments = 0;
  for (const d of week.drivers) {
    const { data: found, error: findError } = await supabase
      .from('drivers')
      .select('id, name, carrier_driver_code')
      .eq('user_id', userId)
      .eq('carrier', week.carrier)
      .eq('carrier_driver_code', d.code);
    if (findError) fail('driver lookup', findError);
    let driverId: string;
    const existing = ((found ?? []) as { id: string; name: string; carrier_driver_code: string | null }[])[0];
    if (existing) {
      driverId = existing.id;
      // A name typed by the owner is never replaced; only the code-as-name.
      if (d.name && existing.name.trim().toUpperCase() === d.code) {
        const { error } = await supabase.from('drivers').update({ name: d.name }).eq('id', driverId);
        if (error) fail('driver name', error);
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('drivers')
        .insert({
          user_id: userId,
          name: d.name || d.code,
          carrier: week.carrier,
          carrier_driver_code: d.code,
          paid_via_carrier_payroll: true,
          compensation_type: 'w2_employee',
          active: true,
        })
        .select('id')
        .single();
      if (error || !inserted) fail('driver insert', error);
      driverId = (inserted as { id: string }).id;
      driversCreated++;
    }
    const { error: payError } = await supabase.from('driver_payments').insert({
      user_id: userId,
      driver_id: driverId,
      settlement_id: settlementId,
      date: weekEnding,
      gross_pay: d.wages,
      employer_taxes: d.employerTaxes,
      work_comp: d.workComp,
      total_cost: d.total,
      source: 'settlement',
      notes: 'W-2 via carrier payroll',
    });
    if (payError) fail('payment insert', payError);
    payments++;
  }
  const { error: teamError } = await supabase.from('settlements').update({ team_week: week.teamWeek }).eq('id', settlementId);
  if (teamError) fail('team week', teamError);
  return { driversCreated, payments };
}
