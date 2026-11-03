// STRUCTURED OUTPUT ON EVERY CALL (owner decision 2026-11-03, R4; device
// finding: parse_failed on 07/24 page 2 and 09/04 page 3). Every model call
// sends output_config.format json_schema, so the reply is always valid JSON
// of the expected shape.
//
// ONE SOURCE: the schema is derived from the JSON templates the prompt
// itself prints ({"docType":"settlement",...}, the classification reply),
// after every approved patch is applied — never a second hand-kept copy
// that could drift from the prompt. Structured outputs only allow the keys
// in the schema (every object additionalProperties:false), so a field the
// prompt asks for that is missing from its template would be lost; the
// drift test (app/src/import/__tests__/outputSchema.test.ts) rebuilds the
// settlement template from index.ts and fails on any such field.
//
// Every property is required (the templates print every key with its
// default), so the schema has no optional or union-typed properties
// (limits: 24 optional, 16 unions). Pure and Deno-free.

export type JsonSchema = Record<string, unknown>;

// Arrays the templates print empty ("items":[]): their item shape.
// Tolls: app/src/import/types.ts ExtractedToll.
const TOLL_ITEM = { date: '', plaza: '', location: '', amount: 0 };
const EMPTY_ARRAY_ITEMS: Record<string, unknown> = {
  'settlement.tolls.ezpass.items': TOLL_ITEM,
  'settlement.tolls.drivewyze.items': TOLL_ITEM,
};

// Every complete JSON object in `text` that starts with `startToken`
// (e.g. '{"docType":"'), parsed. Braces inside strings are skipped.
export function jsonObjectsStartingWith(text: string, startToken: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(startToken, from);
    if (i < 0) break;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\') j++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      const v = JSON.parse(text.slice(i, end + 1));
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      // not a template (prose with braces): skip
    }
    from = i + startToken.length;
  }
  return out;
}

export function schemaOfTemplate(value: unknown, path = ''): JsonSchema {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: 'number' };
  if (value === null) return { type: 'string' };
  if (Array.isArray(value)) {
    const sample = value.length > 0 ? value[0] : (EMPTY_ARRAY_ITEMS[path] ?? '');
    return { type: 'array', items: schemaOfTemplate(sample, path) };
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const properties: Record<string, JsonSchema> = {};
  for (const k of keys) properties[k] = schemaOfTemplate(obj[k], path ? `${path}.${k}` : k);
  return { type: 'object', properties, required: keys, additionalProperties: false };
}

// The docType templates printed in an extraction prompt: docType -> template.
// The first template of a docType wins (later mentions are examples).
export function docTypeTemplates(prompt: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const t of jsonObjectsStartingWith(prompt, '{"docType":"')) {
    const d = t.docType;
    if (typeof d === 'string' && d && !out[d]) out[d] = t;
  }
  return out;
}

// The schema for one extraction call. `docType` known (a page of a
// settlement PDF is always read as a settlement) -> that template; else
// any of the printed docTypes. null when the prompt prints no template.
export function extractionOutputSchema(prompt: string, docType: string | null): JsonSchema | null {
  const templates = docTypeTemplates(prompt);
  if (docType && templates[docType]) return schemaOfTemplate(templates[docType]);
  const all = Object.values(templates);
  if (all.length === 0) return null;
  if (all.length === 1) return schemaOfTemplate(all[0]);
  return { anyOf: all.map((t) => schemaOfTemplate(t)) };
}

// The schema of a reply whose template is the first JSON object starting
// with `startToken` (the classification reply: '{"carrier":').
export function replyOutputSchema(prompt: string, startToken: string): JsonSchema | null {
  const t = jsonObjectsStartingWith(prompt, startToken)[0];
  return t ? schemaOfTemplate(t) : null;
}

// A 400 that means the API refused the schema itself (too complex, an
// unsupported keyword): the call is retried once without it, so a schema
// problem can never stop an import.
export function isSchemaRejection(status: number, bodyText: string): boolean {
  return status === 400 && /schema|output_config|output_format|json_schema|too complex/i.test(bodyText);
}

// The reply text of a failed page, kept (scrubbed by the caller) in
// page_results for Diagnostics: at most this many characters.
export const FAILED_REPLY_MAX_CHARS = 2000;
