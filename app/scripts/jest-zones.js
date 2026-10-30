// Runs the Jest suite once per time zone (batch 0b.1, 2026-10-30): a
// stored date-only value must read the same calendar day in Chicago, UTC
// and Auckland. TZ is set before Jest starts because Node reads it once.
// Usage: npm run test:zones [-- <jest args>]
const { spawnSync } = require('child_process');

const ZONES = ['America/Chicago', 'UTC', 'Pacific/Auckland'];
const args = process.argv.slice(2);
let failed = false;
for (const zone of ZONES) {
  console.log(`\n=== TZ=${zone} ===`);
  const r = spawnSync('npx', ['jest', ...args], { stdio: 'inherit', shell: true, env: { ...process.env, TZ: zone } });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
