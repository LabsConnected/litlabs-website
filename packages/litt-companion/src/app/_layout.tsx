import React from 'react';
import { ClerkProvider } from '@clerk/expo';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CONFIG } from '../lib/config';
import { tokenCache } from '../lib/token-cache';
import { CompanionProvider } from '../lib/auth-context';

export default function RootLayout() {
  const ClerkProviderComp = ClerkProvider as any;
  const StackComp = Stack as any;

  return (
    <ClerkProviderComp
      publishableKey={CONFIG.clerkPublishableKey}
      tokenCache={tokenCache}
    >
      <SafeAreaProvider>
        <CompanionProvider>
          <StatusBar style="light" />
          <StackComp
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#07070e' },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
          </StackComp>
        </CompanionProvider>
      </SafeAreaProvider>
    </ClerkProviderComp>
  );
}
