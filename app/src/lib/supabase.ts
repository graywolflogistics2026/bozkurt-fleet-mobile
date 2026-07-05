import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/src/config/env';
import { LargeSecureStore } from '@/src/lib/largeSecureStore';

// AES+AsyncStorage hybrid (session token encrypted, key held in
// SecureStore/Keychain/Keystore) — see largeSecureStore.ts. Replaces a
// plain expo-secure-store adapter that hit its ~2048-byte per-key limit on
// real Supabase sessions (CLAUDE.md/PROMPTS.md Session 3's originally-noted
// upgrade path, now needed).
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
