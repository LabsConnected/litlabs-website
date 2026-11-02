import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useColorScheme } from "react-native";
import { ClerkProvider } from "@clerk/clerk-expo";
import { isClerkAuthEnabled } from "../src/lib/feature-flags";
import { tokenCache } from "../src/lib/clerk-token-cache";

function AppShell() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#000000" },
          headerTintColor: "#f8f8f2",
          headerTitleStyle: { fontWeight: "bold" },
          contentStyle: { backgroundColor: "#000000" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "LiTT Companion" }} />
        <Stack.Screen name="memory" options={{ title: "Shared Memory" }} />
      </Stack>
    </ThemeProvider>
  );
}

/**
 * Clerk is only wired in when EXPO_PUBLIC_ENABLE_CLERK_AUTH=true. With
 * the flag unset (the default), this renders exactly what RootLayout
 * rendered before this change — no ClerkProvider, no new dependency on
 * the network at startup, no behavior change to the existing app.
 */
export default function RootLayout() {
  if (!isClerkAuthEnabled()) {
    return <AppShell />;
  }

  return (
    <ClerkProvider publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <AppShell />
    </ClerkProvider>
  );
}
