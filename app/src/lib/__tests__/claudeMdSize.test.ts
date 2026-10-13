// CLAUDE.md SIZE GUARD (owner decision 2026-10-13). The repo-root CLAUDE.md
// once grew to 847k chars (Claude Code's limit is ~150k) and broke every
// session with "Prompt is too long". It now stays at 65-70k; dated task
// entries go to docs/CHANGELOG.md and long rationale to docs/decisions/.
import * as fs from 'fs';
import * as path from 'path';

const CLAUDE_MD = path.resolve(__dirname, '../../../../CLAUDE.md');
const MAX_CHARS = 80_000;

describe('CLAUDE.md size guard', () => {
  it(`stays under ${MAX_CHARS} chars`, () => {
    const text = fs.readFileSync(CLAUDE_MD, 'utf8');
    expect(text.length).toBeLessThanOrEqual(MAX_CHARS);
  });

  it('never uses @imports (they load at launch and defeat the size limit)', () => {
    const text = fs.readFileSync(CLAUDE_MD, 'utf8');
    // A bare `@path` outside a code span is read as an import; package
    // names like `@tanstack/...` must stay inside backticks.
    const bare = text
      .split('\n')
      .map(line => line.replace(/`[^`]*`/g, ''))
      .filter(line => /(^|\s)@[\w./-]+/.test(line));
    expect(bare).toEqual([]);
  });

  it('keeps all 25 numbered invariants', () => {
    const text = fs.readFileSync(CLAUDE_MD, 'utf8');
    for (let n = 1; n <= 25; n++) {
      expect(text).toMatch(new RegExp(`^  ${n}\\. `, 'm'));
    }
  });
});
