import 'react-native-get-random-values';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Supabase's documented "LargeSecureStore" hybrid for React Native: plain
// expo-secure-store enforces a ~2048-byte per-key limit, which the Supabase
// session payload can exceed (this app was hitting the warning on real
// sessions). The session JSON itself lives in AsyncStorage (unencrypted
// storage, no size limit), but AES-encrypted with a random key that never
// leaves SecureStore — so the token payload is only ever readable via the
// Keychain/Keystore-protected key, same security property as before, just
// without the size ceiling.
export class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;

    try {
      const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
      const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
      return aesjs.utils.utf8.fromBytes(decryptedBytes);
    } catch (err) {
      // Malformed hex/ciphertext — e.g. a leftover value from before this
      // hybrid adapter existed, or a key/blob pair that's fallen out of
      // sync. Discard gracefully (treat as no session) rather than
      // throwing up through supabase-js's getSession(), which has no
      // storage-layer error handling of its own and would otherwise leave
      // the auth bootstrap promise rejected/unresolved.
      console.warn(`[storage] decrypt("${key}") failed, discarding stale value —`, err);
      return null;
    }
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}
