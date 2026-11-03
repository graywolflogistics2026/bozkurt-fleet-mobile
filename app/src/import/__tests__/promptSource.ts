// Test helper: rebuilds the ai-import extraction prompt (base prompt + every
// BEFORE/AFTER patch + every `prompt += ...` addition) from the index.ts
// SOURCE TEXT, so a Jest test can check the structured-output schema
// against the real prompt (index.ts itself is Deno code and cannot be
// imported here). Interpolations (${...}) become "x" unless they name a
// known string constant; `prompt +=` additions inside an `if` are included
// (a superset is what the drift check needs).
import * as fs from 'fs';
import * as path from 'path';

const INDEX = path.join(__dirname, '../../../../supabase/functions/ai-import/index.ts');

function unescapeTemplate(body: string, constants: Record<string, string>): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) {
      const n = body[++i];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      continue;
    }
    if (ch === '$' && body[i + 1] === '{') {
      const close = body.indexOf('}', i);
      const name = body.slice(i + 2, close).trim();
      out += constants[name] ?? 'x';
      i = close;
      continue;
    }
    out += ch;
  }
  return out;
}

// The end index of the template literal starting at `start` (a backtick).
function templateEnd(src: string, start: number): number {
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (depth === 0 && ch === '`') return i;
    if (ch === '$' && src[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (depth > 0 && ch === '}') depth--;
  }
  return -1;
}

export function indexSource(): string {
  return fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
}

export function stringConstants(src: string): Record<string, string> {
  const constants: Record<string, string> = {};
  const re = /\bconst ([A-Z][A-Z0-9_]*)\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const at = m.index + m[0].length;
    const ch = src[at];
    if (ch === '`') {
      const end = templateEnd(src, at);
      if (end > 0) constants[m[1]] = unescapeTemplate(src.slice(at + 1, end), constants);
    } else if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, at + 1);
      constants[m[1]] = src.slice(at + 1, end);
    } else {
      const alias = /^([A-Z][A-Z0-9_]*)\s*;/.exec(src.slice(at));
      if (alias && constants[alias[1]] != null) constants[m[1]] = constants[alias[1]];
    }
  }
  return constants;
}

export function rebuiltExtractionPrompt(): string {
  const src = indexSource();
  const constants = stringConstants(src);
  const start = src.indexOf('function buildExtractionPrompt(');
  const bodyEnd = src.indexOf('\n}\n', start);
  const body = src.slice(start, bodyEnd);
  let prompt = constants.LEGACY_EXTRACTION_PROMPT ?? '';
  const chain = /\.replace\(([A-Z][A-Z0-9_]*),\s*([A-Z][A-Z0-9_]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = chain.exec(body))) {
    const before = constants[m[1]];
    const after = constants[m[2]];
    if (before != null && after != null) prompt = prompt.replace(before, after);
  }
  if (constants.APPROVED_ADDITIONS_SUFFIX) prompt += constants.APPROVED_ADDITIONS_SUFFIX;
  const add = /prompt \+= `/g;
  while ((m = add.exec(body))) {
    const at = m.index + m[0].length - 1;
    const end = templateEnd(body, at);
    if (end > 0) prompt += unescapeTemplate(body.slice(at + 1, end), constants);
  }
  return prompt;
}
