// R4 — STRUCTURED OUTPUT ON EVERY CALL (owner decision 2026-11-03). The
// schema is derived from the prompt's own templates; this test rebuilds the
// real prompt from index.ts and checks nothing the prompt asks for would be
// dropped by the schema (structured outputs allow only schema keys).
import {
  docTypeTemplates,
  extractionOutputSchema,
  isSchemaRejection,
  jsonObjectsStartingWith,
  replyOutputSchema,
  schemaOfTemplate,
  type JsonSchema,
} from '../../../../supabase/functions/ai-import/outputSchema';
import { indexSource, rebuiltExtractionPrompt } from './promptSource';

const prompt = rebuiltExtractionPrompt();

function hasPath(schema: JsonSchema, parts: string[]): boolean {
  let node: JsonSchema | undefined = schema;
  for (const p of parts) {
    while (node && node.type === 'array') node = node.items as JsonSchema;
    const props = node?.properties as Record<string, JsonSchema> | undefined;
    if (!props || !props[p]) return false;
    node = props[p];
  }
  return true;
}

// Every settlement.<a>.<b> path the prompt prose names.
function settlementPathsInProse(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bsettlement\.([a-zA-Z]+(?:\.[a-zA-Z]+)*)/g)) out.add(m[1]);
  return [...out].sort();
}

function walk(schema: JsonSchema, visit: (s: JsonSchema) => void) {
  visit(schema);
  if (schema.type === 'array') walk(schema.items as JsonSchema, visit);
  for (const v of Object.values((schema.properties as Record<string, JsonSchema>) ?? {})) walk(v, visit);
  for (const v of (schema.anyOf as JsonSchema[]) ?? []) walk(v, visit);
}

describe('R4: structured output schema from the prompt templates', () => {
  test('the prompt prints a settlement template and the main docTypes', () => {
    const templates = docTypeTemplates(prompt);
    expect(Object.keys(templates)).toEqual(expect.arrayContaining(['settlement', 'fuel', 'maintenance', 'amazon']));
  });

  test('every settlement.* field the prompt asks for is in the settlement schema (nothing dropped)', () => {
    const schema = extractionOutputSchema(prompt, 'settlement')!;
    const settlement = (schema.properties as Record<string, JsonSchema>).settlement;
    const missing = settlementPathsInProse(prompt).filter((p) => !hasPath(settlement, p.split('.')));
    expect(missing).toEqual([]);
  });

  test('every <section>.* field the prompt asks for is in its docType schema (fuel.state, purchase.items, ...)', () => {
    const templates = docTypeTemplates(prompt);
    const missing: string[] = [];
    for (const [docType, t] of Object.entries(templates)) {
      const schema = schemaOfTemplate(t);
      for (const [key, value] of Object.entries(t)) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || key === 'settlement') continue;
        for (const m of prompt.matchAll(new RegExp(`\\b${key}\\.([a-zA-Z]+(?:\\.[a-zA-Z]+)*)`, 'g'))) {
          if (!hasPath(schema, [key, ...m[1].split('.')])) missing.push(`${docType}: ${key}.${m[1]}`);
        }
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  test('the R1/R2/R3 fields are in the schema', () => {
    const s = (extractionOutputSchema(prompt, 'settlement')!.properties as Record<string, JsonSchema>).settlement;
    for (const p of ['settlementDateRaw', 'printDateRaw', 'statementWeekEndingRaw', 'operating.weekEndingRaw', 'settlementTotalLines.label', 'operating.lines.weeks', 'operating.lines.ytd', 'operating.lines.ltd', 'operating.totalLines.weeks', 'operating.recapLines.label', 'tolls.ezpass.items.amount']) {
      expect([p, hasPath(s, p.split('.'))]).toEqual([p, true]);
    }
  });

  test('strict: every object closed and fully required, no union-typed property (API limits)', () => {
    for (const schema of [extractionOutputSchema(prompt, 'settlement')!, extractionOutputSchema(prompt, null)!]) {
      walk(schema, (s) => {
        if (s.type === 'object') {
          expect(s.additionalProperties).toBe(false);
          expect(s.required).toEqual(Object.keys(s.properties as object));
        }
        expect(Array.isArray(s.type)).toBe(false);
      });
    }
    expect((extractionOutputSchema(prompt, null)!.anyOf as unknown[]).length).toBeGreaterThan(3);
  });

  test('the classification reply has its own schema', () => {
    const src = indexSource();
    const classify = src.slice(src.indexOf('function buildClassifyPrompt('), src.indexOf('function parseClassification('));
    const text = classify.replace(/\$\{start\}/g, '1');
    const schema = replyOutputSchema(text, '{"carrier":')!;
    expect(schema).toMatchObject({ type: 'object', required: ['carrier', 'pages'] });
    expect(hasPath(schema, ['pages', 'hasTotalCashFlow'])).toBe(true);
  });

  test('template parsing: braces inside strings, nulls, empty arrays', () => {
    const [t] = jsonObjectsStartingWith('x {"docType":"a","note":"{not}","n":null,"list":[]} y', '{"docType":"');
    expect(t).toEqual({ docType: 'a', note: '{not}', n: null, list: [] });
    expect(schemaOfTemplate(t)).toMatchObject({ properties: { n: { type: 'string' }, list: { type: 'array', items: { type: 'string' } } } });
  });

  test('a schema the API refuses is retried without it, never an import failure', () => {
    expect(isSchemaRejection(400, '{"error":{"message":"Schema is too complex for compilation."}}')).toBe(true);
    expect(isSchemaRejection(400, 'output_config.format: unsupported keyword')).toBe(true);
    expect(isSchemaRejection(400, 'messages: text content blocks must be non-empty')).toBe(false);
    expect(isSchemaRejection(500, 'schema')).toBe(false);
  });
});
