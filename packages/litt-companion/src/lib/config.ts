import { Platform } from 'react-native';

/**
 * Mobile configuration for LiTT Companion App.
 * Connects directly to the canonical LiTTree backend API gateway.
 */
const DEFAULT_DEV_API_URL = Platform.select({
  android: 'http://10.0.2.2:3001',
  ios: 'http://localhost:3001',
  default: 'http://localhost:3001',
});

const DEFAULT_PROD_API_URL = 'https://litlabs.net';

export const CONFIG = {
  // Primary API endpoint pointing to litlabs.net or local dev server
  apiUrl:
    process.env.EXPO_PUBLIC_API_URL ||
    (__DEV__ ? DEFAULT_DEV_API_URL : DEFAULT_PROD_API_URL),

  // Clerk authentication publishable key
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '',

  // App details
  appName: 'LiTT Companion',
  appVersion: '1.0.0',
};
