import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/src/config/env';

// expo-secure-store backs Keychain (iOS) / Keystore-encrypted SharedPreferences
// (Android) — CLAUDE.md/PROMPTS.md Session 3 require session tokens never sit
// in plain AsyncStorage. Note: SecureStore enforces a ~2048-byte per-key
// limit; if the session payload ever grows past that (large custom JWT
// claims), switch to the AES+AsyncStorage "LargeSecureStore" hybrid from
// Supabase's React Native guide instead of raising this limit.
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
