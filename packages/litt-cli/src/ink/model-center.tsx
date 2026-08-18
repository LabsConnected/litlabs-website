/**
 * ModelCenter — full model management screen (/models, Ctrl+M).
 *
 * Shows REAL provider status from ModelRuntime (@litt/models):
 *   - Each provider with health tier: DISCOVERY OK / AUTHENTICATED / CONFIGURED / DEGRADED / DOWN
 *   - Credential type: BYOK ✓ / Local
 *   - Models actually discovered per provider (from OpenRouter /models)
 *   - Latency from health check
 *   - Unavailable models shown with reason (can't be selected)
 *   - Model provider vs transport attribution (e.g. "OpenAI · via OpenRouter")
 *
 * Truth rule (same as VerificationGate):
 *   A model is only shown as available if discovery confirmed it.
 *   Static catalog presence alone never implies usability.
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEscape } from "./keyboard-utils.js";
import { COLORS, costTier } from "./colors.js";
import { ModelRuntime, type ProviderStatus } from "../lib/model-runtime.js";
import type { ModelDefinition, ProviderId } from "@litt/models";
import type { RoutingMode } from "../lib/model-routing.js";

export interface ModelCenterProps {
  routingMode: RoutingMode;
  selectedModelId: string | null;
  /** Active model label (what the runtime is actually using). */
  activeModel?: string | null;
  hasApiKey: boolean;
  onCancel: () => void;
  /** Injected ModelRuntime (shared with controller). Optional — creates own if absent. */
  modelRuntime?: ModelRuntime;
}

const TIER_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  "discovery-ok": { icon: "●", color: COLORS.success, label: "READY" },
  "authenticated": { icon: "●", color: COLORS.success, label: "AUTH OK" },
  "configured": { icon: "○", color: COLORS.secondary, label: "CONFIGURED" },
  "inference-verified": { icon: "✓", color: COLORS.success, label: "VERIFIED" },
  "degraded": { icon: "⚠", color: COLORS.warning, label: "DEGRADED" },
  "down": { icon: "✗", color: COLORS.error, label: "DOWN" },
};

export function ModelCenter({ routingMode, selectedModelId, activeModel, hasApiKey, onCancel, modelRuntime: injectedRuntime }: ModelCenterProps): React.ReactElement {
  const { exit } = useApp();
  const runtimeRef = useRef<ModelRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = injectedRuntime ?? new ModelRuntime();
  const runtime = runtimeRef.current;

  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [discoveredCount, setDiscoveredCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Show last-known status immediately (from health cache)
    const showCached = () => {
      setStatuses(runtime.getProviderStatuses());
      setModels(runtime.getAllModels());
      setDiscoveredCount(runtime.getDiscoveredCount());
      setLoading(false);
    };
    showCached();

    // Refresh in background — real OpenRouter /models discovery
    setRefreshing(true);
    runtime.refresh().then(() => {
      if (!cancelled) {
        showCached();
        setRefreshing(false);
      }
    }).catch(() => {
      if (!cancelled) setRefreshing(false);
    });

    return () => { cancelled = true; };
  }, [runtime]);

  useOverlayKeyboard("model-center", (_, key) => {
    if (isEscape(key, "")) onCancel();
  });

  if (loading) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
        <Text bold color={COLORS.brand}>LiTT MODEL CENTER</Text>
        <Text dimColor>Discovering providers...</Text>
      </Box>
    );
  }

  // Group models by their native provider (model provider, not transport)
  const modelsByProvider = new Map<ProviderId, ModelDefinition[]>();
  for (const m of models) {
    const list = modelsByProvider.get(m.provider) ?? [];
    list.push(m);
    modelsByProvider.set(m.provider, list);
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.brand}>LiTT MODEL CENTER</Text>
        <Text dimColor> — real provider status</Text>
        {refreshing && <Text color={COLORS.working}> (refreshing...)</Text>}
      </Box>

      {/* ─── PROVIDERS ─── */}
      <Text dimColor bold>PROVIDERS</Text>
      <Box flexDirection="column" marginBottom={1}>
        {statuses.length === 0 && (
          <Box marginLeft={2}>
            <Text dimColor>No providers checked yet. {hasApiKey ? "Refresh to discover." : "Set OPENROUTER_API_KEY."}</Text>
          </Box>
        )}
        {statuses.map((status) => {
          const tier = TIER_CONFIG[status.tier] ?? { icon: "?", color: COLORS.secondary, label: status.tier.toUpperCase() };
          return (
            <Box key={status.providerId} flexDirection="column" marginBottom={0}>
              <Box>
                <Text color={tier.color} bold>{tier.icon}</Text>
                <Text color={status.hasCredential ? COLORS.text : COLORS.secondary} bold>
                  {" "}{status.label.padEnd(12)}
                </Text>
                <Text color={tier.color}> {tier.label}</Text>
                <Text dimColor> · {status.hasCredential ? "✓" : "✗"}</Text>
                {status.latencyMs !== null && (
                  <Text dimColor> · {status.latencyMs}ms</Text>
                )}
                {status.discoveredCount > 0 && (
                  <Text dimColor> · {status.discoveredCount} models</Text>
                )}
                {status.servedBy !== status.providerId && status.hasCredential && (
                  <Text color={COLORS.info} dimColor> · via {status.servedBy}</Text>
                )}
              </Box>
              {status.reason && status.tier === "down" && (
                <Box marginLeft={4}>
                  <Text color={COLORS.error} dimColor>  {status.reason}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* ─── MODELS BY PROVIDER ─── */}
      <Text dimColor bold>MODELS{discoveredCount > 0 ? ` · ${discoveredCount} discovered` : ""}</Text>
      <Box flexDirection="column" marginBottom={1}>
        {[...modelsByProvider.entries()].map(([provider, providerModels]) => {
          const providerStatus = statuses.find((s) => s.providerId === provider);
          const viaOpenRouter = providerStatus?.servedBy === "openrouter" && provider !== "openrouter";
          return (
            <Box key={provider} flexDirection="column" marginBottom={0}>
              <Text dimColor bold>
                {provider.toUpperCase()}{viaOpenRouter ? " · via OpenRouter" : ""}
              </Text>
              {providerModels.map((model) => {
                const isOnline = model.availability === "online";
                const isOffline = model.availability === "offline";
                const isUnverified = model.availability === "unverified";
                const statusIcon = isOnline ? "✓" : isOffline ? "✗" : "?";
                const statusLabel = isOnline ? "READY" : isOffline ? "OFFLINE" : "UNVERIFIED";
                const statusColor = isOnline ? COLORS.success : isOffline ? COLORS.error : COLORS.warning;
                const isSelected = model.canonicalId === selectedModelId;
                const isActive = activeModel && model.displayName === activeModel;

                return (
                  <Box key={model.canonicalId} marginLeft={2}>
                    <Text color={statusColor}>{statusIcon}</Text>
                    <Text color={isOnline ? COLORS.text : COLORS.secondary}>
                      {" "}{model.displayName.padEnd(24)}
                    </Text>
                    <Text color={statusColor}> {statusLabel.padEnd(10)}</Text>
                    <Text dimColor> {model.description.slice(0, 20).padEnd(20)}</Text>
                    <Text color={COLORS.warning}>{costTier(model.pricing ? model.pricing.inputPer1M + model.pricing.outputPer1M : 0)}</Text>
                    {isSelected && <Text color={COLORS.brand} bold> ◀ selected</Text>}
                    {isActive && !isSelected && <Text color={COLORS.info} bold> ◀ active</Text>}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {/* ─── CURRENT ─── */}
      <Text dimColor bold>CURRENT</Text>
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>Policy     </Text>
          <Text color={COLORS.brand} bold>{routingMode.toUpperCase()}</Text>
        </Box>
        <Box>
          <Text dimColor>Selected   </Text>
          <Text color={COLORS.info}>{selectedModelId ?? "auto"}</Text>
        </Box>
        {activeModel && (
          <Box>
            <Text dimColor>Active     </Text>
            <Text color={COLORS.success} bold>{activeModel}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>Credential </Text>
          <Text color={hasApiKey ? COLORS.success : COLORS.error}>
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
