import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

interface ApprovalCardProps {
  approvalId: string;
  action: string;
  metadata?: Record<string, unknown>;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
}

export function ApprovalCard({ approvalId, action, metadata, onApprove, onReject }: ApprovalCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.warningTag}>⚠️ APPROVAL REQUIRED</Text>
      </View>
      <Text style={styles.actionText}>{action}</Text>
      {metadata ? (
        <Text style={styles.metaText}>{JSON.stringify(metadata, null, 2)}</Text>
      ) : null}

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.approveBtn} onPress={() => onApprove(approvalId)}>
          <Text style={styles.approveBtnText}>Approve Execution</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rejectBtn} onPress={() => onReject(approvalId)}>
          <Text style={styles.rejectBtnText}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1c1917",
    borderColor: "#b45309",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
  },
  header: {
    marginBottom: 6,
  },
  warningTag: {
    color: "#f59e0b",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  actionText: {
    color: "#fef3c7",
    fontSize: 14,
    fontWeight: "600",
    marginVertical: 4,
  },
  metaText: {
    color: "#d97706",
    fontSize: 11,
    fontFamily: "monospace",
    marginVertical: 4,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  approveBtn: {
    backgroundColor: "#10b981",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    flex: 1,
    alignItems: "center",
  },
  approveBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
  },
  rejectBtn: {
    backgroundColor: "#334155",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  rejectBtnText: {
    color: "#94a3b8",
    fontWeight: "600",
    fontSize: 12,
  },
});
