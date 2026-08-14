/**
 * ModelCenter — full model management screen (/models).
 *
 * Shows REAL provider status from ProviderRegistry:
 *   - Each provider with health: READY / NO KEY / RATE LIMITED / DOWN
 *   - Credential type: BYOK ✓ / LiTT Credits ✓ / Local
 *   - Models actually discovered per provider
 *   - Latency from health check
 *   - Unavailable models shown with reason (can't be selected)
 *
 * This is the "advanced" view. /model is the quick switch.
 *
 * Truth rule (same as VerificationGate):
 *   A model is only shown as available if its provider credential
 *   is present and healthy. No pretending.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEscape } from "./keyboard-utils.js";
import { COLORS, healthColor, costTier } from "./colors.js";
import { MODEL_CATALOG, type ModelChoice, type RoutingMode } from "../lib/model-routing.js";
import {
  ProviderRegistry,
  type ProviderStatus,
  type DiscoveredModel,
} from "../lib/provider-registry.js";

export interface ModelCenterProps {
  routingMode: RoutingMode;
  selectedModelId: string | null;
  hasApiKey: boolean;
  onCancel: () => void;
}

const HEALTH_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  "ready": { icon: "●", color: "green", label: "READY" },
  "unverified": { icon: "?", color: "yellow", label: "UNVERIFIED" },
  "no-key": { icon: "○", color: "gray", label: "NO KEY" },
  "rate-limited": { icon: "⚠", color: "yellow", label: "RATE LIMITED" },
  "down": { icon: "✗", color: "red", label: "DOWN" },
};

const CRED_LABEL: Record<string, string> = {
  "byok": "BYOK",
  "litt-credits": "LiTT Credits",
  "free": "Free",
  "local": "Local",
};

export function ModelCenter({ routingMode, selectedModelId, hasApiKey, onCancel }: ModelCenterProps): React.ReactElement {
  const { exit } = useApp();
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const registry = new ProviderRegistry(MODEL_CATALOG);

    // Show last-known status immediately (async refresh, no blocking)
    registry.refreshAsync();
    setStatuses(registry.getProviderStatuses());
    setLoading(false);

    // Refresh in background, then update
    setRefreshing(true);
    registry.refresh().then(() => {
      if (!cancelled) {
        setStatuses(registry.getProviderStatuses());
        setRefreshing(false);
      }
    }).catch(() => {
      if (!cancelled) setRefreshing(false);
    });

    return () => { cancelled = true; };
  }, []);

  useOverlayKeyboard("model-center", (_, key) => {
    if (isEscape(key, "")) onCancel();
  });

  if (loading) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
        <Text bold color="magenta">LiTT MODEL CENTER</Text>
        <Text dimColor>Discovering providers...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
        <Text bold color="red">LiTT MODEL CENTER — ERROR</Text>
        <Text color="red">{error}</Text>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">LiTT MODEL CENTER</Text>
        <Text dimColor> — real provider status</Text>
      </Box>

      {/* Providers with real health + discovered models */}
      <Text dimColor bold>PROVIDERS</Text>
      <Box flexDirection="column" marginBottom={1}>
        {statuses.map((status) => {
          const health = HEALTH_CONFIG[status.health] ?? HEALTH_CONFIG["unknown"];
          const credLabel = CRED_LABEL[status.provider.credentialType] ?? "Unknown";
          return (
            <Box key={status.provider.id} flexDirection="column" marginBottom={0}>
              {/* Provider header */}
              <Box>
                <Text color={health.color} bold>{health.icon}</Text>
                <Text color={status.hasCredential ? "white" : "gray"} bold>
                  {" "}{status.provider.label.padEnd(12)}
                </Text>
                <Text color={health.color}> {health.label}</Text>
                <Text dimColor> · {credLabel}{status.hasCredential ? " ✓" : ""}</Text>
                {status.latencyMs !== null && (
                  <Text dimColor> · {status.latencyMs}ms</Text>
                )}
                {status.servedBy !== status.provider.id && status.hasCredential && (
                  <Text color="cyan" dimColor> · via {status.servedBy}</Text>
                )}
              </Box>
              {/* Discovered models */}
              {status.models.length > 0 ? (
                <Box flexDirection="column" marginLeft={4}>
                  {status.models.map((model: DiscoveredModel) => (
                    <Box key={model.choice.id}>
                      <Text color={model.available ? (model.proven ? "green" : "yellow") : "gray"}>
                        {model.available ? (model.proven ? "✓" : "?") : "○"}
                      </Text>
                      <Text color={model.available ? "white" : "gray"}>
                        {" "}{model.choice.label}
                      </Text>
                      {model.available && !model.proven && (
                        <Text color="yellow" dimColor> (unverified)</Text>
                      )}
                      {!model.available && model.unavailableReason && (
                        <Text color="red" dimColor> — {model.unavailableReason}</Text>
                      )}
                      {model.choice.id === selectedModelId && (
                        <Text color="magenta" bold> ◀ selected</Text>
                      )}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box marginLeft={4}>
                  <Text dimColor>Models: —</Text>
                </Box>
              )}
              {/* Error message */}
              {status.error && (
                <Box marginLeft={4}>
                  <Text color="red" dimColor>  {status.error}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Current selection */}
      <Text dimColor bold>CURRENT</Text>
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>Routing: </Text>
          <Text color="magenta" bold>{routingMode.toUpperCase()}</Text>
        </Box>
        <Box>
          <Text dimColor>Selected: </Text>
          <Text color="cyan">{selectedModelId ?? "auto"}</Text>
        </Box>
        <Box>
          <Text dimColor>Credential: </Text>
          <Text color={hasApiKey ? "green" : "red"}>
            {hasApiKey ? "✓ API key set" : "✗ No API key"}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Esc to close · Use /model for quick switch · Ctrl+M</Text>
      </Box>
    </Box>
  );
}
