/**
 * SecureStore-backed token cache for @clerk/clerk-expo.
 *
 * Clerk's React Native SDK needs a persistent token cache to keep the
 * session alive across app restarts. expo-secure-store is the standard
 * choice (Android Keystore / iOS Keychain backed) — this is the
 * documented Clerk Expo integration pattern, not a custom one.
 */
import * as SecureStore from "expo-secure-store";

export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Best-effort — a failed save just means the user re-authenticates
      // next launch instead of crashing the app.
    }
  },
};
