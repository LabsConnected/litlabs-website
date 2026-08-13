import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity } from "react-native";

interface LabModeProps {
  visible: boolean;
  onClose: () => void;
}

export function LabModeModal({ visible, onClose }: LabModeProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>🧪 LAB MODE DIAGNOSTICS</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.grid}>
            <View style={styles.item}>
              <Text style={styles.label}>Expo SDK</Text>
              <Text style={styles.value}>57.0.0</Text>
            </View>
            <View style={styles.item}>
              <Text style={styles.label}>React Native</Text>
              <Text style={styles.value}>0.81.5 / RN 0.86</Text>
            </View>
            <View style={styles.item}>
              <Text style={styles.label}>Runtime Brain</Text>
              <Text style={styles.value}>Canonical LiTT Gateway</Text>
            </View>
            <View style={styles.item}>
              <Text style={styles.label}>Transport</Text>
              <Text style={styles.value}>Duplex WebSocket + SSE</Text>
            </View>
            <View style={styles.item}>
              <Text style={styles.label}>Protocol</Text>
              <Text style={styles.value}>LiTTEventBase v1</Text>
            </View>
            <View style={styles.item}>
              <Text style={styles.label}>Local Storage</Text>
              <Text style={styles.value}>SQLite + SecureStore</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.closeFullBtn} onPress={onClose}>
            <Text style={styles.closeFullBtnText}>Exit Lab Mode</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#07070e",
    borderColor: "#8b5cf6",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    width: "100%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    color: "#a78bfa",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 1,
  },
  closeBtn: {
    color: "#94a3b8",
    fontSize: 18,
    fontWeight: "600",
  },
  grid: {
    gap: 12,
    marginBottom: 20,
  },
  item: {
    backgroundColor: "#0f172a",
    padding: 10,
    borderRadius: 8,
  },
  label: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  value: {
    color: "#f1f5f9",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
    fontFamily: "monospace",
  },
  closeFullBtn: {
    backgroundColor: "#8b5cf6",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  closeFullBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
});
