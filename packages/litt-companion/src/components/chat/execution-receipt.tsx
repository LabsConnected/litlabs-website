import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking } from "react-native";
import { ExecutionReceipt } from "../../lib/protocol";

interface ExecutionReceiptProps {
  receipt: ExecutionReceipt;
  onOpenPreview?: (url: string) => void;
  onRollback?: (receiptId: string) => void;
}

export function ExecutionReceiptCard({ receipt, onOpenPreview, onRollback }: ExecutionReceiptProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>LiTT Execution Receipt</Text>
        <Text style={styles.badge}>VERIFIED</Text>
      </View>

      <View style={styles.detailsList}>
        <Text style={styles.detailText}>✓ {receipt.filesModified} file(s) modified</Text>
        <Text style={styles.detailText}>
          {receipt.typecheckPassed ? "✓ Typecheck passed" : "✕ Typecheck failed"}
        </Text>
        <Text style={styles.detailText}>
          {receipt.buildPassed ? "✓ Build passed" : "✕ Build failed"}
        </Text>
      </View>

      <View style={styles.actionsRow}>
        {receipt.previewUrl ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              if (onOpenPreview && receipt.previewUrl) {
                onOpenPreview(receipt.previewUrl);
              } else if (receipt.previewUrl) {
                Linking.openURL(receipt.previewUrl);
              }
            }}
          >
            <Text style={styles.primaryButtonText}>Open Preview</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => onRollback && onRollback(receipt.receiptId)}
        >
          <Text style={styles.secondaryButtonText}>Rollback</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0d0e17",
    borderColor: "#1e2238",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    color: "#e2e8f0",
    fontWeight: "700",
    fontSize: 14,
  },
  badge: {
    backgroundColor: "#10b98122",
    color: "#10b981",
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  detailsList: {
    marginVertical: 6,
    gap: 4,
  },
  detailText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  primaryButton: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 12,
  },
  secondaryButton: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  secondaryButtonText: {
    color: "#cbd5e1",
    fontWeight: "600",
    fontSize: 12,
  },
});
