import { useCallback, useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, useSignIn } from "@clerk/clerk-expo";
import { isClerkAuthEnabled } from "../src/lib/feature-flags";
import { api } from "../src/lib/api";

interface MemoryRecord {
  id: string;
  content: string;
  created_at: string;
}

/**
 * Minimal "does shared memory work from this device" screen. Only
 * reachable behind EXPO_PUBLIC_ENABLE_CLERK_AUTH — with the flag off,
 * this route isn't linked from anywhere and _layout.tsx never mounts
 * ClerkProvider, so the Clerk hooks below would throw if this screen
 * were reached without the flag. The guard below makes that failure
 * mode an explicit message instead of a crash.
 */
export default function MemoryScreen() {
  if (!isClerkAuthEnabled()) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <Text style={styles.message}>
          Shared memory is behind a feature flag. Set
          EXPO_PUBLIC_ENABLE_CLERK_AUTH=true in .env.local to enable it.
        </Text>
      </SafeAreaView>
    );
  }

  return <MemoryScreenWithAuth />;
}

function MemoryScreenWithAuth() {
  const { isSignedIn, getToken } = useAuth();
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const result = await api.get<{ memories: MemoryRecord[] }>("/api/memory", { token });
      setMemories(result.memories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  const handleSignIn = useCallback(async () => {
    if (!signInLoaded) return;
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email, password });
      if (attempt.status === "complete") {
        await setActive({ session: attempt.createdSessionId });
      } else {
        setError(`Sign-in requires additional steps: ${attempt.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  }, [email, password, signIn, signInLoaded, setActive]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.content}>
        <Text style={styles.title}>Shared Memory</Text>
        {!isSignedIn ? (
          <>
            <Text style={styles.message}>Sign in with the same LiTT account used on Windows/web.</Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#666"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#666"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Button title="Sign in" onPress={handleSignIn} />
            {error && <Text style={styles.error}>{error}</Text>}
          </>
        ) : (
          <>
            <Button title="Refresh" onPress={fetchMemories} />
            {loading && <ActivityIndicator style={styles.spacer} />}
            {error && <Text style={styles.error}>{error}</Text>}
            {memories.map((m) => (
              <Text key={m.id} style={styles.memoryItem}>
                {m.content}
              </Text>
            ))}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  content: { flex: 1, padding: 24 },
  title: { fontSize: 24, fontWeight: "bold", color: "#f8f8f2", marginBottom: 16 },
  message: { color: "#8be9fd", fontSize: 14, padding: 24 },
  error: { color: "#ff5555", marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 6,
    color: "#f8f8f2",
    padding: 10,
    marginTop: 12,
  },
  memoryItem: { color: "#f8f8f2", marginTop: 12 },
  spacer: { marginTop: 12 },
});
