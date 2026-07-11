import en from '@/src/i18n/locales/en.json';
import es from '@/src/i18n/locales/es.json';
import ru from '@/src/i18n/locales/ru.json';
import ar from '@/src/i18n/locales/ar.json';
import tr from '@/src/i18n/locales/tr.json';
import hi from '@/src/i18n/locales/hi.json';
import uk from '@/src/i18n/locales/uk.json';

// docs/I18N_GLOSSARY.md — keep this array in sync with that file. Any new
// glossary term must be added to both in the same change.
const GLOSSARY_TERMS = [
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
];

const LOCALES: Record<string, unknown> = { es, ru, ar, tr, hi, uk };

type Flat = Record<string, string>;

function flatten(obj: unknown, prefix: string, out: Flat): Flat {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (typeof obj === 'string') {
    out[prefix] = obj;
  }
  return out;
}

function escapeRegex(term: string): string {
  return term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// Word-boundary match on both sides: the term must not be embedded inside
// a longer word (e.g. "DEF" must not match "Default", "DOT" must not match
// "anecdote"). An optional trailing "s" is allowed before the right
// boundary so an English plural ("settlements") still counts as compliant.
function containsTerm(str: string, term: string): boolean {
  const re = new RegExp(`(^|[^a-zA-Z])${escapeRegex(term)}s?($|[^a-zA-Z])`, 'i');
  return re.test(str);
}

const enFlat = flatten(en, '', {});

describe('i18n glossary (docs/I18N_GLOSSARY.md) — DO-NOT-TRANSLATE terms stay English in every locale', () => {
  for (const term of GLOSSARY_TERMS) {
    const keysWithTerm = Object.keys(enFlat).filter((k) => containsTerm(enFlat[k], term));

    if (keysWithTerm.length === 0) continue;

    describe(`"${term}"`, () => {
      for (const key of keysWithTerm) {
        for (const [locale, data] of Object.entries(LOCALES)) {
          it(`stays in English for ${locale}.json at "${key}"`, () => {
            const localeFlat = flatten(data, '', {});
            const translated = localeFlat[key];
            expect(translated).toBeDefined();
            expect(containsTerm(translated, term)).toBe(true);
          });
        }
      }
    });
  }
});
