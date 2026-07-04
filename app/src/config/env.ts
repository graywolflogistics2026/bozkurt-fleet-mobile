// Reads Supabase connection info from EXPO_PUBLIC_* env vars, which Expo
// inlines into the JS bundle at build time (see .env.example at the app/
// root — copy it to .env and fill in the anon key). Never hardcode these
// values in component code.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy app/.env.example to app/.env and fill in the anon key, then ' +
      'restart the dev server (env vars are only read at bundle time).'
  );
}

export const env = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
};
