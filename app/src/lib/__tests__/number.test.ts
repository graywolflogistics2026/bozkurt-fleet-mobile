// Batch 0b.4 (2026-10-30): ONE shared number parser.
import * as fs from 'fs';
import * as path from 'path';
import { num, numOrNull } from '@/src/lib/number';
import { parseAmount, printedTotal } from '@/src/import/amount';

describe('numOrNull', () => {
  it.each<[unknown, number | null]>([
    ['3,212.19', 3212.19],
    ['184.85-', -184.85],
    ['.37-', -0.37],
    ['47.34-', -47.34],
    ['(12.50)', -12.5],
    ['$1,884.73', 1884.73],
    ['.37', 0.37],
    [' 1 884.73 ', 1884.73],
    ['$ 2,534.36', 2534.36],
    ['-$5.00', -5],
    ['$-5.00', -5],
    ['+12', 12],
    ['1,202.92-', -1202.92],
    ['12.', 12],
    ['0', 0],
    [42, 42],
    [-0.5, -0.5],
    // Not numbers: null, never a partial read.
    ['', null],
    ['   ', null],
    ['N/A', null],
    ['12abc', null],
    ['1,2', null],
    ['1,23,456', null],
    ['(12.50)-', null],
    ['--5', null],
    ['$', null],
    ['-', null],
    ['.', null],
    [NaN, null],
    [Infinity, null],
    [null, null],
    [undefined, null],
    [{}, null],
  ])('%p -> %p', (input, expected) => {
    expect(numOrNull(input)).toBe(expected);
  });

  it('num() falls back only when the text is not a number', () => {
    expect(num('3,212.19')).toBe(3212.19);
    expect(num('N/A')).toBe(0);
    expect(num('N/A', 7)).toBe(7);
    expect(num('0', 7)).toBe(0);
  });

  it('the import parser shares it ("3,212.19" used to read as 3)', () => {
    expect(parseAmount('3,212.19')).toBe(3212.19);
    expect(parseAmount('3,212.19-')).toBe(-3212.19);
    expect(Number.isNaN(parseAmount('12abc'))).toBe(true);
    expect(printedTotal('$1,884.73')).toBe(1884.73);
  });
});

// Source check: no screen parses typed text with Number()/parseFloat().
describe('source check', () => {
  const root = path.resolve(__dirname, '../../..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'app'));

  it('never calls parseFloat()', () => {
    const hits = files.filter((f) => !f.endsWith(path.join('lib', 'number.ts'))).filter((f) => /\bparseFloat\(/.test(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')));
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('never Number()s a form field or a typed draft', () => {
    const re = /Number\((?:(?:form|addForm|editForm|draft|newLoan)(?:\.\w+)+|\w*(?:Draft|Input|Amount|Text)\b)\s*\)/;
    const hits = files.flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l) && re.test(l))
        .map((l) => `${path.relative(root, f)}: ${l.trim()}`)
    );
    expect(hits).toEqual([]);
  });
});
