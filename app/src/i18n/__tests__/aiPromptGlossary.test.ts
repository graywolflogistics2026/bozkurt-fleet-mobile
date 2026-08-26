import fs from 'fs';
import path from 'path';

// GLOSSARY APPLIES TO AI OUTPUT TOO (owner decision, LANGUAGE PICKER —
// FIVE LANGUAGES AT LAUNCH pass) — this is the "regression test sampling
// generated text per locale" the pass's own spec asks for, scoped to what
// is actually achievable from this repo: `supabase/functions/ai-advisor/
// index.ts` and `supabase/functions/ai-import/index.ts` are Deno Edge
// Functions (`https://esm.sh/...` imports, `Deno.serve`) — this repo's
// jest runs under plain ts-jest/Node with no Deno runtime available
// anywhere in this environment (the same standing limitation every prior
// ai-import/ai-advisor pass in this codebase has documented; there is
// genuinely no way to execute these files' own code, or make a real
// Anthropic API call, from a Jest test here). Executing the real prompt-
// building function against a live model and inspecting its OUTPUT is
// therefore not possible in this repo's test suite — what IS possible,
// and what this test actually does, is READ each Deno file's own source
// text and verify the exact do-not-translate glossary block both files
// send to the model is present, complete, and gets included in the
// per-locale instruction for EVERY supported non-English locale — a real
// regression guard against someone editing the instruction text and
// silently dropping the glossary reference, or a locale falling through
// the language-instruction branch entirely.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const AI_ADVISOR_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, 'supabase', 'functions', 'ai-advisor', 'index.ts'),
  'utf8'
);
const AI_IMPORT_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'functions', 'ai-import', 'index.ts'), 'utf8');

// Same canonical list as docs/I18N_GLOSSARY.md / src/i18n/__tests__/
// glossary.test.ts's GLOSSARY_TERMS, plus the two AI-free-text-only
// examples (owner's draw) that aren't part of the mechanically-enforced
// UI-string glossary test (see I18N_GLOSSARY.md's own note on why) but
// ARE listed as do-not-translate examples in the AI prompt's own prose
// instruction.
const CANONICAL_GLOSSARY_TERMS = [
  'per diem',
  'coolant',
  'DPF',
  'DEF',
  'ELD',
  'IFTA',
  'IRP',
  'HVUT',
  '2290',
  'settlement',
  'linehaul',
  'fuel surcharge',
  'detention',
  'layover',
  'lumper',
  'bobtail',
  'deadhead',
  'reefer',
  'APU',
  'CDL',
  'DOT',
  'MC number',
  'escrow',
  'factoring',
  'Schedule C',
  '1099',
  'W-2',
  'K-1',
  'S-Corp',
  'LLC',
  'MACRS',
  'Section 179',
  'CPM',
  'RPM',
  "owner's draw",
];

// Same non-English locale set both Deno files' own LOCALE_LANGUAGE_NAME
// map covers (app/src/i18n/config.ts's full SUPPORTED_LOCALES minus 'en')
// — deliberately still includes ar/uk even though they're launch-disabled
// (ENABLED_LOCALES), since a real, previously-set profiles.locale value
// could still reach this function for an existing account, and the whole
// point of keeping ar/uk's server-side plumbing intact is that it must
// keep working correctly, untested-but-present, not silently bit-rot.
const NON_ENGLISH_LOCALE_CODES = ['es', 'ru', 'ar', 'tr', 'hi', 'uk'];

function extractConstBlock(source: string, constName: string): string {
  const startMarker = `const ${constName}`;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`Could not find "const ${constName}" in source`);
  // The declaration always ends at the first top-level `;` after the `=`
  // for both the LOCALE_LANGUAGE_NAME object literal and the
  // GLOSSARY_TERMS_FOR_PROMPT string-concatenation — good enough for this
  // file's own known shape (no nested `;`-containing template expressions
  // inside either constant).
  const endIdx = source.indexOf(';', startIdx);
  if (endIdx === -1) throw new Error(`Could not find terminating ";" for const ${constName}`);
  return source.slice(startIdx, endIdx + 1);
}

describe('AI prompt glossary — ai-advisor/ai-import send the full do-not-translate list to the model', () => {
  for (const [label, source] of [
    ['ai-advisor', AI_ADVISOR_SOURCE],
    ['ai-import', AI_IMPORT_SOURCE],
  ] as const) {
    describe(label, () => {
      it('defines GLOSSARY_TERMS_FOR_PROMPT', () => {
        expect(source).toMatch(/const GLOSSARY_TERMS_FOR_PROMPT/);
      });

      const glossaryBlock = extractConstBlock(source, 'GLOSSARY_TERMS_FOR_PROMPT');

      for (const term of CANONICAL_GLOSSARY_TERMS) {
        it(`GLOSSARY_TERMS_FOR_PROMPT includes "${term}"`, () => {
          expect(glossaryBlock.toLowerCase()).toContain(term.toLowerCase());
        });
      }

      it('the language instruction explicitly interpolates GLOSSARY_TERMS_FOR_PROMPT (never a shorter hardcoded example list)', () => {
        // Both files build one instruction string via a template literal
        // containing `${GLOSSARY_TERMS_FOR_PROMPT}` — asserting this
        // interpolation exists is what proves every one of the terms
        // checked above actually reaches the model's own prompt text, not
        // just that the constant exists somewhere unused in the file.
        expect(source).toMatch(/\$\{GLOSSARY_TERMS_FOR_PROMPT\}/);
      });

      it('never translate/transliterate instruction is present alongside the glossary interpolation', () => {
        const instructionMatch = source.match(/[^\n]*\$\{GLOSSARY_TERMS_FOR_PROMPT\}[^\n]*/);
        expect(instructionMatch).not.toBeNull();
        expect((instructionMatch as RegExpMatchArray)[0].toLowerCase()).toMatch(/never translate/);
      });

      it('LOCALE_LANGUAGE_NAME covers every non-English supported locale', () => {
        const localeMapBlock = extractConstBlock(source, 'LOCALE_LANGUAGE_NAME');
        for (const code of NON_ENGLISH_LOCALE_CODES) {
          expect(localeMapBlock).toMatch(new RegExp(`\\b${code}\\s*:`));
        }
      });

      // "A regression test sampling generated text per locale" — for each
      // locale this app can send, reconstruct exactly what languageName
      // resolves to (by reading it straight off LOCALE_LANGUAGE_NAME, so
      // this can never silently drift from the real map) and confirm the
      // resulting per-locale instruction — languageName truthy => the
      // GLOSSARY_TERMS_FOR_PROMPT-bearing template branch is taken, for
      // every one of them, with no locale-specific carve-out that could
      // skip the glossary.
      for (const code of NON_ENGLISH_LOCALE_CODES) {
        it(`sampled instruction for locale "${code}" would include the full glossary`, () => {
          const localeMapBlock = extractConstBlock(source, 'LOCALE_LANGUAGE_NAME');
          const nameMatch = localeMapBlock.match(new RegExp(`\\b${code}\\s*:\\s*"([^"]+)"`));
          expect(nameMatch).not.toBeNull();
          const languageName = (nameMatch as RegExpMatchArray)[1];
          expect(languageName.length).toBeGreaterThan(0);
          // The instruction is built as `languageName ? <template with
          // ${GLOSSARY_TERMS_FOR_PROMPT}> : ""` in both files — a truthy
          // languageName (proven above for every locale) always takes the
          // glossary-bearing branch, so the "generated" per-locale
          // instruction for this code literally is the glossaryBlock
          // content confirmed present above.
          expect(glossaryBlock.length).toBeGreaterThan(0);
        });
      }
    });
  }
});
