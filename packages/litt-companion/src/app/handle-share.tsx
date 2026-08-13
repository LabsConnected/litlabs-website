import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { useRouter } from "expo-router";

export default function HandleShareScreen() {
  const router = useRouter();
  const [activeProject, setActiveProject] = useState<string | null>("LiTTree Website");
  const [promptText, setPromptText] = useState("");

  const handleSendToLiTT = () => {
    router.replace({
      pathname: "/(tabs)",
      params: { initialPrompt: promptText, projectId: activeProject || undefined },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Send to LiTT</Text>
      <Text style={styles.subtitle}>Attached content received from Android share</Text>

      <View style={styles.projectSelector}>
        <Text style={styles.projectLabel}>Project Context:</Text>
        <TouchableOpacity style={styles.projectPill} onPress={() => setActiveProject(activeProject ? null : "LiTTree Website")}>
          <Text style={styles.projectPillText}>{activeProject ? `Project: ${activeProject} ▾` : "No project (General Chat) ▾"}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="What should LiTT do with this content?"
        placeholderTextColor="#64748b"
        value={promptText}
        onChangeText={setPromptText}
        multiline
      />

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.sendButton} onPress={handleSendToLiTT}>
          <Text style={styles.sendButtonText}>Send to LiTT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.replace("/(tabs)")}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#07070e",
    padding: 20,
    justifyContent: "center",
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 4,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 13,
    marginBottom: 20,
  },
  projectSelector: {
    marginBottom: 16,
  },
  projectLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  projectPill: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  projectPillText: {
    color: "#a78bfa",
    fontWeight: "700",
    fontSize: 13,
  },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: "#f8fafc",
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  sendButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    alignItems: "center",
  },
  sendButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: "#1e293b",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#94a3b8",
    fontWeight: "600",
    fontSize: 14,
  },
});
