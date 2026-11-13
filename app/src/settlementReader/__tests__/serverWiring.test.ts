// The Edge Function wiring of the new reader (supabase/functions/ai-import).
// Deno code is not run by Jest; these checks keep the wiring from drifting:
// every reader mode is dispatched, the server runs the bundled core (never
// a copy of its decisions), and no reader call can reach a Fable model.
import * as fs from 'fs';
import * as path from 'path';
import { ROLE_MODEL } from '../cost';

const FN = path.join(__dirname, '../../../../supabase/functions/ai-import');
const index = fs.readFileSync(path.join(FN, 'index.ts'), 'utf8');
const server = fs.readFileSync(path.join(FN, 'reader/server.ts'), 'utf8');

describe('ai-import wiring of the settlement reader', () => {
  test.each(['read_start', 'read_again', 'read_answer', 'read_resume'])('mode %s is dispatched', (mode) => {
    expect(index).toMatch(new RegExp(`body\\.mode === "${mode}"\\) return await handle`));
  });

  test('the server runs the bundled core', () => {
    expect(server).toContain('import * as core from "./core.gen.js"');
    expect(server).toContain('core.runReader(');
    expect(index).toContain('import * as readerCore from "./reader/core.gen.js"');
  });

  test('a reader job continues in the reader, never in the old engine', () => {
    expect(index).toMatch(/isReaderRow\(row\.progress\)\) runInBackground\(runReaderJob/);
    expect(index).toMatch(/isReaderRow\(withProgress\?\.progress\)\) return await handleReadResume/);
  });

  test('models come from ROLE_MODEL only; no Fable anywhere in the reader', () => {
    expect(server).not.toMatch(/claude-[a-z]+-\d/);
    expect(server).not.toMatch(/fable/i);
    expect(Object.values(ROLE_MODEL).every((m) => /^claude-(opus|haiku)-5-5$/.test(m))).toBe(true);
  });

  test('structured output, adaptive thinking, effort and a cached PDF block on every reader call', () => {
    expect(server).toContain('thinking: { type: "adaptive" }');
    expect(server).toContain('output_config: { effort: req.effort');
    expect(server).toContain('format: { type: "json_schema", schema: req.schema }');
    expect(server).toContain('cache_control: { type: "ephemeral" }');
  });
});
