// COST PER ROLE (owner decision 2026-11-13: "cost logged per role; report
// the measured cost of one 8-page and one 17-page statement"). Dollar
// ESTIMATE from the API's own usage numbers and the published per-MTok
// prices (Claude API, standard tier, as of 2026-11; Haiku 5.5 uses its
// <=100K-token rate card, larger prompts its higher one). Never shown to
// the owner as a bill: Diagnostics and the Send report only.

export type ReaderRole = 'range' | 'content' | 'split_settlement' | 'split_statement' | 'attachment';
export const ROLE_MODEL: Record<ReaderRole, string> = {
  range: 'claude-haiku-5-5',
  content: 'claude-opus-5-5',
  split_settlement: 'claude-opus-5-5',
  split_statement: 'claude-opus-5-5',
  attachment: 'claude-haiku-5-5',
};
export const ROLE_EFFORT: Record<ReaderRole, 'low' | 'medium'> = {
  range: 'low',
  content: 'medium',
  split_settlement: 'medium',
  split_statement: 'medium',
  attachment: 'low',
};

type Rate = { input: number; output: number; cacheWrite: number; cacheRead: number };
const PRICES: Record<string, Rate | ((promptTokens: number) => Rate)> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': (prompt) =>
    prompt <= 100_000 ? { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 } : { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type CostEntry = {
  role: ReaderRole;
  model: string;
  page?: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  usd: number;
  ms: number;
  outcome: string;
};

export function costOf(model: string, usage: Usage | null | undefined): number {
  const u = {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    write: usage?.cache_creation_input_tokens ?? 0,
    read: usage?.cache_read_input_tokens ?? 0,
  };
  const entry = PRICES[model];
  if (!entry) return 0;
  const rate = typeof entry === 'function' ? entry(u.input + u.write + u.read) : entry;
  const usd = (u.input * rate.input + u.output * rate.output + u.write * rate.cacheWrite + u.read * rate.cacheRead) / 1_000_000;
  return Math.round(usd * 10000) / 10000;
}

export function costEntry(role: ReaderRole, model: string, usage: Usage | null | undefined, ms: number, outcome: string, page?: number): CostEntry {
  return {
    role,
    model,
    ...(page != null ? { page } : {}),
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    usd: costOf(model, usage),
    ms,
    outcome,
  };
}

// Per role, for the report: calls, tokens and dollars.
export function costByRole(entries: CostEntry[]): { role: ReaderRole; calls: number; inputTokens: number; outputTokens: number; usd: number }[] {
  const out = new Map<ReaderRole, { role: ReaderRole; calls: number; inputTokens: number; outputTokens: number; usd: number }>();
  for (const e of entries) {
    const row = out.get(e.role) ?? { role: e.role, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    row.calls += 1;
    row.inputTokens += e.inputTokens + e.cacheWriteTokens + e.cacheReadTokens;
    row.outputTokens += e.outputTokens;
    row.usd = Math.round((row.usd + e.usd) * 10000) / 10000;
    out.set(e.role, row);
  }
  return [...out.values()];
}

export function totalCost(entries: CostEntry[]): number {
  return Math.round(entries.reduce((s, e) => s + e.usd, 0) * 10000) / 10000;
}
