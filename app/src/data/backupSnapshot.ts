import { supabase } from '@/src/lib/supabase';

async function fetchAll(table: string, userId: string) {
  const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

// D5 (docs/SCHEMA.sql): JSON snapshots to the private `backups` bucket, one
// per import, NOT a database table. Since Postgres (not localStorage) is
// now the source of truth, this snapshot is a fresh full export of the
// user's own data read back out of Supabase — the mobile equivalent of
// legacy's buildBackupPayload()/autoBackupToDrive() (legacy/index.html:2209,
// 2231), just sourced from tables instead of localStorage keys.
//
// Deliberately fire-and-forget: swallows its own errors so a backup hiccup
// never fails the import the user actually cares about. Call it without
// awaiting from the UI layer.
export async function buildAndUploadBackupSnapshot(userId: string): Promise<void> {
  try {
    const [
      trucks,
      settlements,
      loads,
      fuelPurchases,
      deductions,
      maintenanceRecords,
      tolls,
      reimbursements,
      loans,
      creditCards,
      capitalTransactions,
      truckHealthConfig,
      bankStatements,
      bankTransactions,
      profileResult,
    ] = await Promise.all([
      fetchAll('trucks', userId),
      fetchAll('settlements', userId),
      fetchAll('loads', userId),
      fetchAll('fuel_purchases', userId),
      fetchAll('deductions', userId),
      fetchAll('maintenance_records', userId),
      fetchAll('tolls', userId),
      fetchAll('reimbursements', userId),
      fetchAll('loans', userId),
      fetchAll('credit_cards', userId),
      fetchAll('capital_transactions', userId),
      fetchAll('truck_health_config', userId),
      fetchAll('bank_statements', userId),
      fetchAll('bank_transactions', userId),
      supabase.from('profiles').select('business_balance, initial_capital').eq('user_id', userId).maybeSingle(),
    ]);

    const snapshot = {
      exportedAt: new Date().toISOString(),
      trucks,
      settlements,
      loads,
      fuelPurchases,
      deductions,
      maintenanceRecords,
      tolls,
      reimbursements,
      loans,
      creditCards,
      capitalTransactions,
      truckHealthConfig,
      bankStatements,
      bankTransactions,
      businessBalance: profileResult.data?.business_balance ?? null,
      initialCapital: profileResult.data?.initial_capital ?? null,
    };

    const path = `${userId}/backups/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const { error } = await supabase.storage.from('backups').upload(path, JSON.stringify(snapshot), {
      contentType: 'application/json',
      upsert: true,
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[backup-snapshot] fire-and-forget snapshot failed:', err);
  }
}
