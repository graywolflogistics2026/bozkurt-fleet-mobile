// The server's copy of the gate is GENERATED from the app's own modules
// (owner decision 2026-11-13: one gate, never a second copy). This fails
// when supabase/functions/ai-import/reader/core.gen.js is older than the
// app code it was built from: run `npm run build:reader` and commit it.
import * as fs from 'fs';
import * as vm from 'vm';
import { evaluateSettlementGate } from '@/src/import/settlementGate';
import { withStatement } from '@/src/data/__tests__/golden0814Fixture';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildReaderCore, OUT } = require('../../../scripts/buildReaderCore.js') as {
  buildReaderCore: (format?: 'esm' | 'cjs') => string;
  OUT: string;
};

function loadCjs(code: string): Record<string, (...args: unknown[]) => unknown> {
  const module = { exports: {} as Record<string, (...args: unknown[]) => unknown> };
  vm.runInNewContext(code, { module, exports: module.exports, Math, Date, Number, String, Object, Array, Set, Map, JSON, RegExp, Intl });
  return module.exports;
}

describe('reader core bundle', () => {
  test('the committed bundle is up to date (run npm run build:reader)', () => {
    const committed = fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
    expect(committed === buildReaderCore()).toBe(true);
  });

  test('the bundled gate gives the same verdict as the app gate (08/14 golden week)', () => {
    const core = loadCjs(buildReaderCore('cjs'));
    const extraction = withStatement({});
    const options = { importDate: '2026-08-15' };
    const server = core.evaluateSettlementGate(extraction, options) as { status: string; headline?: unknown };
    const app = evaluateSettlementGate(extraction, options);
    expect(server.status).toBe('pass');
    expect(JSON.parse(JSON.stringify(server))).toEqual(JSON.parse(JSON.stringify(app)));
  });

  test('the bundle imports nothing (Deno runs it as is)', () => {
    const code = buildReaderCore();
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\(/);
  });
});
