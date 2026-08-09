import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://litlabs.net";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.content}>
        <Text style={styles.title}>LiTT Companion</Text>
        <Text style={styles.subtitle}>LiTTree Lab Studios</Text>
        <Text style={styles.apiUrl}>API: {API_URL}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#f8f8f2",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#8be9fd",
    marginBottom: 32,
  },
  apiUrl: {
    fontSize: 12,
    color: "#444444",
    fontFamily: "monospace",
  },
});
