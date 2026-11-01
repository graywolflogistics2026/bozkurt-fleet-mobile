// PLAN-AWARE IMPORT BUDGET (owner decision 2026-10-31, after the move to
// Supabase Pro). Default = Free (150 s documented, exit by 130 s); the
// secret AI_IMPORT_SUPABASE_PLAN=pro switches background jobs to the paid
// budget (400 s documented, exit by 300 s). Both run here on the simulated
// clock of ./jobSimulation.ts, whose platform kills a worker at the plan's
// DOCUMENTED wall clock. Durations are estimates; the limits are exact.
import fs from 'fs';
import path from 'path';
import {
  FREE_PLAN_WALL_CLOCK_MS,
  MIN_CALL_END_MARGIN_MS,
  MIN_EXIT_MARGIN_MS,
  PAID_PLAN_EXIT_BY_MS,
  PAID_PLAN_WALL_CLOCK_MS,
  PLAN_SECRET_NAME,
  STALE_LEASE_AFTER_MS,
  callTimeoutNow,
  leaseIsStale,
  leaseMsFor,
  limitsFor,
  limitsForPlan,
  planTierFrom,
  MAX_PAGE_ATTEMPTS,
  type SupabasePlanTier,
} from '../../../../supabase/functions/ai-import/jobEngine';
import { AUTO_RESUME_AFTER_MS } from '@/src/import/importJobs';
import { attachmentMix, primeDoc, simulateImport, unknownCarrierDoc } from './jobSimulation';

const free = limitsForPlan('free');
// primeDoc(6, ...) = 6 settlement + 2 statement pages, then attachments.
const CONTENT_PAGES = [1, 2, 3, 4, 5, 6, 7, 8];
const contentReads = (calls: Map<number, number>) => CONTENT_PAGES.map((p) => calls.get(p) ?? 0);
const withinAttempts = (calls: Map<number, number>) => [...calls.values()].every((n) => n <= MAX_PAGE_ATTEMPTS);
const paid = limitsForPlan('paid');

describe('the plan setting', () => {
  it('is named AI_IMPORT_SUPABASE_PLAN; unset, empty or unknown values stay on Free', () => {
    expect(PLAN_SECRET_NAME).toBe('AI_IMPORT_SUPABASE_PLAN');
    for (const raw of [undefined, null, '', '  ', 'free', 'FREE', 'hobby', '400000', '300', 'pro-ish', 'yes']) {
      expect(planTierFrom(raw)).toBe('free');
    }
    for (const raw of ['pro', 'Pro', ' PRO ', 'paid', 'team', 'enterprise']) expect(planTierFrom(raw)).toBe('paid');
  });

  it('Free is unchanged: documented 150 s, calls end by 140 s, nothing starts after 130 s', () => {
    expect(FREE_PLAN_WALL_CLOCK_MS).toBe(150_000);
    expect(free).toEqual(limitsFor(150_000));
    expect(free).toEqual({ wallClockMs: 150_000, callEndLimitMs: 140_000, startMarginMs: 15_000, exitByMs: 130_000 });
  });

  it('Pro: documented 400 s, the worker uses about 300 s (exit by 300 s, calls end by 310 s)', () => {
    expect(PAID_PLAN_WALL_CLOCK_MS).toBe(400_000);
    expect(PAID_PLAN_EXIT_BY_MS).toBe(300_000);
    expect(paid).toEqual({ wallClockMs: 400_000, callEndLimitMs: 310_000, startMarginMs: 15_000, exitByMs: 300_000 });
  });

  it.each<SupabasePlanTier>(['free', 'paid'])('%s never assumes more than the documented limit minus the safety margin', (tier) => {
    const l = limitsForPlan(tier);
    expect(l.exitByMs).toBeLessThanOrEqual(l.wallClockMs - MIN_EXIT_MARGIN_MS);
    expect(l.callEndLimitMs).toBeLessThanOrEqual(l.wallClockMs - MIN_CALL_END_MARGIN_MS);
    expect(l.exitByMs).toBeLessThan(l.callEndLimitMs);
    // The lease outlives the DOCUMENTED wall clock, not just the budget.
    expect(leaseMsFor(l)).toBeGreaterThan(l.wallClockMs);
  });

  it('the start rule at both limits: a 100 s call may start up to 25 s (Free) / 195 s (Pro); nothing after exit', () => {
    expect(callTimeoutNow(free, 25_000, 100_000, 100_000)).toBe(100_000);
    expect(callTimeoutNow(free, 25_001, 100_000, 100_000)).toBeNull();
    expect(callTimeoutNow(paid, 195_000, 100_000, 100_000)).toBe(100_000);
    expect(callTimeoutNow(paid, 195_001, 100_000, 100_000)).toBeNull();
    expect(callTimeoutNow(paid, 240_000, 100_000, 45_000)).toBe(55_000);
    expect(callTimeoutNow(paid, 250_001, 100_000, 45_000)).toBeNull();
    expect(callTimeoutNow(paid, 300_000, 100_000, 1)).toBeNull();
  });
});

describe('simulated clock at both limits (platform kills at 150 s / 400 s)', () => {
  const seventeen = () => primeDoc(6, attachmentMix(11));

  it.each<SupabasePlanTier>(['free', 'paid'])('%s: the 17-page Prime PDF finishes, no run is stopped, every call obeys the start rule', async (plan) => {
    const l = limitsForPlan(plan);
    const sim = await simulateImport(seventeen(), { plan });
    expect(sim.violations).toEqual([]);
    expect(sim.invocations.some((i) => i.killed)).toBe(false);
    for (const inv of sim.invocations) expect((inv.endMs ?? 0) - inv.startMs).toBeLessThanOrEqual(l.exitByMs + l.startMarginMs);
    for (const inv of sim.invocations) expect((inv.endMs ?? 0) - inv.startMs).toBeLessThan(l.wallClockMs);
    expect(sim.row.status).toBe('ready');
    expect(contentReads(sim.pageCalls)).toEqual(CONTENT_PAGES.map(() => 1));
    expect(withinAttempts(sim.pageCalls)).toBe(true);
  });

  it('Pro needs fewer runs and reaches "ready" no later than Free', async () => {
    const f = await simulateImport(seventeen(), { plan: 'free' });
    const p = await simulateImport(seventeen(), { plan: 'paid' });
    expect(p.invocations.length).toBeLessThan(f.invocations.length);
    expect(p.readyAtMs!).toBeLessThanOrEqual(f.readyAtMs!);
    expect(p.modelCalls.content).toBe(f.modelCalls.content);
    expect(p.modelCalls.classify).toBe(f.modelCalls.classify);
  });

  it.each<SupabasePlanTier>(['free', 'paid'])('%s: a 40-page unknown-carrier file finishes within the limits', async (plan) => {
    const l = limitsForPlan(plan);
    const sim = await simulateImport(unknownCarrierDoc(40), { plan });
    expect(sim.violations).toEqual([]);
    expect(sim.invocations.some((i) => i.killed)).toBe(false);
    for (const inv of sim.invocations) expect((inv.endMs ?? 0) - inv.startMs).toBeLessThan(l.wallClockMs);
    expect(sim.row.status).toBe('ready');
  });

  it('a Free-budget worker on the Free platform is never killed; a Pro budget on the Free platform WOULD be (why the default stays Free)', async () => {
    const sim = await simulateImport(seventeen(), { plan: 'free' });
    expect(sim.invocations.some((i) => i.killed)).toBe(false);
    // Documented, not simulated: Pro's 300 s exit is past Free's 150 s kill.
    expect(paid.exitByMs).toBeGreaterThan(FREE_PLAN_WALL_CLOCK_MS);
  });
});

describe('stale lease: a stopped Pro worker never blocks the app restart', () => {
  it('the Pro lease (405 s) outlives the app restart (3 min); the Free one (155 s) does not', () => {
    expect(leaseMsFor(free)).toBeLessThan(AUTO_RESUME_AFTER_MS);
    expect(leaseMsFor(paid)).toBeGreaterThan(AUTO_RESUME_AFTER_MS);
  });

  it('a lease is stale only after 2 minutes without a heartbeat (a live worker writes one every 20 s)', () => {
    expect(STALE_LEASE_AFTER_MS).toBe(120_000);
    expect(STALE_LEASE_AFTER_MS).toBeLessThan(AUTO_RESUME_AFTER_MS);
    expect(leaseIsStale(0, 119_999)).toBe(false);
    expect(leaseIsStale(0, 120_000)).toBe(true);
    expect(leaseIsStale(null, 0)).toBe(true);
  });

  it.each<SupabasePlanTier>(['free', 'paid'])('%s: the platform stops run 2 early; the restart after 3 minutes finishes the job, finished pages are not read again', async (plan) => {
    const sim = await simulateImport(primeDoc(6, attachmentMix(11)), { plan, killAt: [{ invocation: 2, afterMs: 20_000 }] });
    expect(sim.invocations[1].killed).toBe(true);
    expect(sim.row.status).toBe('ready');
    expect(sim.invocations.filter((i) => i.result?.kind === 'not_owner')).toEqual([]);
    // Only the content page(s) in flight when the worker was stopped are read again.
    expect(contentReads(sim.pageCalls).filter((n) => n > 1).length).toBeLessThanOrEqual(2);
    // A call cut off by the platform is redone; the STORED attempts stay within the limit.
    expect(Object.values(sim.row.results).every((r) => r.status === 'done' && r.attempts <= MAX_PAGE_ATTEMPTS)).toBe(true);
    // Pro: the restart came long before the stopped worker's 405 s lease would have expired by itself.
    if (plan === 'paid') expect(sim.invocations[2].startMs).toBeLessThan(sim.invocations[1].startMs + leaseMsFor(paid));
    // The restart came 3 minutes after the stopped run's last sign of life,
    // well before the Pro lease would have expired by itself.
    const restart = sim.invocations[2];
    expect(restart.startMs - sim.invocations[1].startMs).toBeLessThan(leaseMsFor(limitsForPlan(plan)) + 180_000);
  });

  it('a lost self-invoke on Pro is covered by the restart too', async () => {
    const sim = await simulateImport(primeDoc(6, attachmentMix(11)), { plan: 'paid', dropSelfInvoke: true });
    expect(sim.row.status).toBe('ready');
    expect(contentReads(sim.pageCalls)).toEqual(CONTENT_PAGES.map(() => 1));
    expect(withinAttempts(sim.pageCalls)).toBe(true);
  });
});

describe('server wiring (source checks)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/functions/ai-import/index.ts'), 'utf8');

  it('background jobs read the plan secret; the old raw-number secret is no longer used for limits', () => {
    expect(src).toContain('const JOB_LIMITS = limitsForPlan(JOB_PLAN_TIER);');
    expect(src).toContain('planTierFrom(Deno.env.get(PLAN_SECRET_NAME))');
    expect(src).not.toMatch(/limitsFor\(readWallClockMs\(\)\)/);
  });

  it('the direct (non-job) path stays on the Free budget — the app waits for it at most 240 s', () => {
    expect(src).toContain('const HARD_INVOCATION_BUDGET_MS = limitsFor(FREE_PLAN_WALL_CLOCK_MS).exitByMs;');
    const call = fs.readFileSync(path.resolve(__dirname, '../../data/aiImportCall.ts'), 'utf8');
    const clientTimeout = Number(/PDF_CLIENT_TIMEOUT_MS = ([\d_]+)/.exec(call)![1].replace(/_/g, ''));
    expect(free.exitByMs + 20_000).toBeLessThan(clientTimeout);
    expect(paid.exitByMs).toBeGreaterThan(clientTimeout);
  });

  it('resume releases a lease only when its heartbeat is 2 minutes old, re-checked in the write', () => {
    expect(src).toContain('leaseIsStale(Number.isFinite(heartbeatMs) ? heartbeatMs : null, nowMs)');
    expect(src).toContain('.or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoffIso}`)');
  });
});
