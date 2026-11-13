// SETTLEMENT READER CORE (owner decision 2026-11-13). Everything the
// ai-import Edge Function needs from the app's pure modules, in ONE entry:
// the one gate, the sanitize chain and the profit-line questions. esbuild
// bundles this file into supabase/functions/ai-import/reader/core.gen.js
// (`npm run build:reader`), so the server runs the SAME gate as the app,
// never a second copy. A Jest test fails when that file is stale.
// Pure: nothing here may import React Native, Expo, i18n or Supabase.
export { evaluateSettlementGate } from '@/src/import/settlementGate';
export { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
export { profitLineConflicts, profitLineSuggestions, profitLinesToAsk, withTypedStatementLines } from '@/src/import/primeStatementTemplate';
export * from './schema';
export * from './prompt';
export * from './range';
export * from './cost';
export * from './machine';
export { readingToExtraction } from './toExtraction';
export * from './driver';
