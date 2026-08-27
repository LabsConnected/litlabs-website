/**
 * ModelCenter — full canonical model management screen (F2, /models).
 *
 * Interactive: keyboard selection of routing policy AND exact models.
 *   Tab      — switch between Routing / Models
 *   ↑/↓      — navigate items
 *   Enter    — select (routing mode or exact model)
 *   Esc      — close WITHOUT changing selection
 *
 * Shows REAL provider status from the shared canonical ModelRuntime
 * (@litt/models):
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
 *   Discovery failures show the ACTUAL reason — never "Models: —".
 *
 * Both F2 (this screen) and /model (ModelPicker) mutate the same
 * shared canonical ModelRuntime instance passed in from CockpitApp.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEnter, isEscape, isTab, isUpArrow, isDownArrow } from "./keyboard-utils.js";
import { COLORS, costTier } from "./colors.js";
import { ModelRuntime, type ProviderStatus } from "../lib/model-runtime.js";
import type { ModelDefinition, ProviderId } from "@litt/models";
import type { RoutingMode, ModelChoice } from "../lib/model-routing.js";

export interface ModelCenterProps {
  routingMode: RoutingMode;
  selectedModelId: string | null;
  /** Active model label (what the runtime is actually using). */
  activeModel?: string | null;
  hasApiKey: boolean;
  onCancel: () => void;
  /** Select a routing policy (AUTO/BUDGET/MAX/FIXED). */
  onSelectRoutingMode?: (mode: RoutingMode) => void;
  /** Select an exact model (FIXED). */
  onSelectModel?: (model: ModelChoice) => void;
  /** Shared canonical ModelRuntime — injected from CockpitApp. Required. */
  modelRuntime: ModelRuntime;
}

const TIER_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  "discovery-ok": { icon: "●", color: COLORS.success, label: "READY" },
  "authenticated": { icon: "●", color: COLORS.success, label: "AUTH OK" },
  "configured": { icon: "○", color: COLORS.secondary, label: "CONFIGURED" },
  "inference-verified": { icon: "✓", color: COLORS.success, label: "VERIFIED" },
  "degraded": { icon: "⚠", color: COLORS.warning, label: "DEGRADED" },
  "down": { icon: "✗", color: COLORS.error, label: "DOWN" },
};

const ROUTING_MODES: { id: RoutingMode; label: string; description: string }[] = [
  { id: "auto", label: "AUTO", description: "LiTT chooses the best engine" },
  { id: "fixed", label: "FIXED", description: "Always use the selected model" },
  { id: "budget", label: "BUDGET", description: "Lowest-cost capable engine" },
  { id: "max", label: "MAX", description: "Strongest available engine" },
];

type DiscoveryState = "loading" | "ok" | "error" | "empty";

export function ModelCenter({
  routingMode,
  selectedModelId,
  activeModel,
  hasApiKey,
  onCancel,
  onSelectRoutingMode,
  onSelectModel,
  modelRuntime,
}: ModelCenterProps): React.ReactElement {
  const [tab, setTab] = useState<"routing" | "models">("routing");
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>("loading");
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Routing tab cursor
  const [routingIdx, setRoutingIdx] = useState(() => {
    const idx = ROUTING_MODES.findIndex((m) => m.id === routingMode);
    return idx >= 0 ? idx : 0;
  });

  // Models tab — flat list of selectable (online or unverified+ routable) models
  const selectableModels = models.filter(
    (m) => m.availability === "online" || (m.availability !== "offline" && modelRuntime.isRoutable(m.canonicalId)),
  );
  const [modelIdx, setModelIdx] = useState(() => {
    const idx = selectableModels.findIndex((m) => m.canonicalId === selectedModelId);
    return idx >= 0 ? idx : 0;
  });

  useEffect(() => {
    let cancelled = false;

    const showCached = () => {
      setStatuses(modelRuntime.getProviderStatuses());
      setModels(modelRuntime.getAllModels());
    };

    // Show last-known state immediately (from health cache)
    showCached();
    const cachedError = modelRuntime.lastRefreshError;
    if (modelRuntime.getDiscoveredCount() > 0 || (statuses.length > 0 && statuses.some((s) => s.discoveredCount > 0))) {
      setDiscoveryState("ok");
      setDiscoveryError(null);
    } else if (cachedError) {
      setDiscoveryState("error");
      setDiscoveryError(cachedError);
    } else {
      setDiscoveryState("loading");
    }

    // Refresh in background — real OpenRouter /models discovery
    setRefreshing(true);
    modelRuntime.refresh().then(() => {
      if (cancelled) return;
      showCached();
      setRefreshing(false);
      const discovered = modelRuntime.getDiscoveredCount();
      if (discovered > 0) {
        setDiscoveryState("ok");
        setDiscoveryError(null);
      } else {
        // No models discovered — is it an error or genuinely empty?
        const downProvider = modelRuntime.getProviderStatuses().find((s) => s.tier === "down");
        if (downProvider) {
          setDiscoveryState("error");
          setDiscoveryError(downProvider.reason || downProvider.error || `${downProvider.label} is down`);
        } else if (modelRuntime.lastRefreshError) {
          setDiscoveryState("error");
          setDiscoveryError(modelRuntime.lastRefreshError);
        } else {
          setDiscoveryState("empty");
        }
      }
    }).catch((err) => {
      if (cancelled) return;
      setRefreshing(false);
      const reason = err instanceof Error ? err.message : String(err);
      setDiscoveryState("error");
      setDiscoveryError(reason);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelRuntime]);

  // Keep model cursor valid as the selectable list changes
  useEffect(() => {
    if (modelIdx >= selectableModels.length) {
      setModelIdx(Math.max(0, selectableModels.length - 1));
    }
  }, [selectableModels.length, modelIdx]);

  // Keyboard handler — registered with OverlayManager
  const KEY_DEBUG = process.env.LITT_KEY_DEBUG === "1";
  useOverlayKeyboard("model-center", useCallback((input, key) => {
    if (KEY_DEBUG) {
      process.stderr.write(`[KEY] model-center input=${JSON.stringify(input)} return=${key.return} escape=${key.escape} tab=${key.tab} up=${key.upArrow} down=${key.downArrow} ctrl=${key.ctrl} currentTab=${tab}\n`);
    }
    if (isTab(key)) {
      setTab((prev) => (prev === "routing" ? "models" : "routing"));
      return;
    }
    if (isEscape(key, input)) {
      // Esc closes WITHOUT changing selection
      onCancel();
      return;
    }

    if (tab === "routing") {
      if (isUpArrow(key)) {
        setRoutingIdx((prev) => Math.max(0, prev - 1));
      } else if (isDownArrow(key)) {
        setRoutingIdx((prev) => Math.min(ROUTING_MODES.length - 1, prev + 1));
      } else if (isEnter(key, input)) {
        const mode = ROUTING_MODES[routingIdx].id;
        onSelectRoutingMode?.(mode);
        // Switch to models tab after choosing FIXED so the user can pick
        // an exact model; otherwise stay on routing.
        if (mode === "fixed") setTab("models");
      }
    } else {
      // Models tab
      if (isUpArrow(key)) {
        setModelIdx((prev) => Math.max(0, prev - 1));
      } else if (isDownArrow(key)) {
        setModelIdx((prev) => Math.min(selectableModels.length - 1, prev + 1));
      } else if (isEnter(key, input)) {
        const model = selectableModels[modelIdx];
        if (model) {
          onSelectModel?.({
            id: model.canonicalId,
            label: model.displayName,
            provider: model.provider,
            description: model.description,
            strengths: model.recommendedFor ?? [],
            cost: model.pricing ? model.pricing.inputPer1M + model.pricing.outputPer1M : 0,
            power: model.intelligence === "frontier" ? 5 : model.intelligence === "balanced" ? 3 : 1,
            contextK: Math.round(model.contextWindow / 1000),
          } as ModelChoice);
        }
      }
    }
  }, [tab, routingIdx, modelIdx, selectableModels, onSelectRoutingMode, onSelectModel, onCancel]));

  // Group models by their native provider (model provider, not transport)
  const modelsByProvider = new Map<ProviderId, ModelDefinition[]>();
  for (const m of models) {
    const list = modelsByProvider.get(m.provider) ?? [];
    list.push(m);
    modelsByProvider.set(m.provider, list);
  }

  const discoveredCount = modelRuntime.getDiscoveredCount();

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.secondaryDim} paddingX={2} paddingY={1}>
      {/* Title bar with tab indicator */}
      <Box marginBottom={1}>
        <Text bold color={COLORS.text}>LiTT MODEL CENTER</Text>
        <Text dimColor>  </Text>
        <Text color={tab === "routing" ? COLORS.brand : COLORS.secondary} bold={tab === "routing"}>
          {tab === "routing" ? "[Routing]" : " Routing "}
        </Text>
        <Text dimColor>  </Text>
        <Text color={tab === "models" ? COLORS.brand : COLORS.secondary} bold={tab === "models"}>
          {tab === "models" ? "[Models]" : " Models "}
        </Text>
        {refreshing && <Text color={COLORS.working}> (refreshing...)</Text>}
      </Box>

      {/* ─── PROVIDERS (always visible — truth) ─── */}
      <Text dimColor>PROVIDERS</Text>
      <Box flexDirection="column" marginBottom={1}>
        {statuses.length === 0 && (
          <Box marginLeft={2}>
            <Text dimColor>No providers checked yet. {hasApiKey ? "Refresh to discover." : "Set OPENAI_API_KEY or OPENROUTER_API_KEY."}</Text>
          </Box>
        )}
        {statuses.map((status) => {
          const tier = TIER_CONFIG[status.tier] ?? { icon: "?", color: COLORS.secondary, label: status.tier.toUpperCase() };
          const showReason = status.tier === "down" || status.tier === "degraded";
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
              {showReason && (status.reason || status.error) && (
                <Box marginLeft={4}>
                  <Text color={COLORS.error} dimColor>  {status.error ?? status.reason}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* ─── ROUTING TAB ─── */}
      {tab === "routing" && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>ROUTING POLICY</Text>
          {ROUTING_MODES.map((mode, idx) => {
            const isSelected = idx === routingIdx;
            const isActive = mode.id === routingMode;
            return (
              <Box key={mode.id}>
                <Text color={isSelected ? COLORS.brand : undefined}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text color={isSelected ? COLORS.brand : COLORS.text} bold={isSelected}>
                  {" "}{mode.label.padEnd(10)}
                </Text>
                <Text dimColor>  {mode.description}</Text>
                {isActive && <Text color={COLORS.success}> ✓ active</Text>}
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>Enter to apply · FIXED then switches to Models tab to pick an exact model</Text>
          </Box>
        </Box>
      )}

      {/* ─── MODELS TAB ─── */}
      {tab === "models" && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>MODELS{discoveredCount > 0 ? ` · ${discoveredCount} discovered` : ""}</Text>

          {/* Truthful discovery state — never "Models: —" */}
          {discoveryState === "loading" && (
            <Box marginLeft={2} marginBottom={1}>
              <Text color={COLORS.working}>Discovering models from OpenRouter...</Text>
            </Box>
          )}
          {discoveryState === "error" && (
            <Box marginLeft={2} marginBottom={1} flexDirection="column">
              <Text color={COLORS.error} bold>✗ Discovery failed</Text>
              <Text color={COLORS.error}>  {discoveryError ?? "Unknown error"}</Text>
              <Text dimColor>  Check OPENAI_API_KEY / OPENROUTER_API_KEY and network. Esc to close.</Text>
            </Box>
          )}
          {discoveryState === "empty" && (
            <Box marginLeft={2} marginBottom={1}>
              <Text color={COLORS.warning}>No models discovered. {hasApiKey ? "Provider returned zero models." : "Set OPENAI_API_KEY or OPENROUTER_API_KEY."}</Text>
            </Box>
          )}

          {discoveryState !== "loading" && modelsByProvider.size > 0 && (
            <Box flexDirection="column">
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
                      const statusIcon = isOnline ? "✓" : isOffline ? "✗" : "?";
                      const statusLabel = isOnline ? "READY" : isOffline ? "OFFLINE" : "UNVERIFIED";
                      const statusColor = isOnline ? COLORS.success : isOffline ? COLORS.error : COLORS.warning;
                      const isSelected = model.canonicalId === selectedModelId;
                      const isActive = activeModel && model.displayName === activeModel;
                      const isSelectable = isOnline || (!isOffline && modelRuntime.isRoutable(model.canonicalId));
                      // Cursor position in the flat selectable list
                      const flatIdx = selectableModels.findIndex((m) => m.canonicalId === model.canonicalId);
                      const isCursor = flatIdx === modelIdx && isSelectable;

                      return (
                        <Box key={model.canonicalId} marginLeft={2}>
                          <Text color={isCursor ? COLORS.brand : undefined}>
                            {isCursor ? ">" : " "}
                          </Text>
                          <Text color={statusColor}>{statusIcon}</Text>
                          <Text color={isOnline ? COLORS.text : COLORS.secondary}>
                            {" "}{model.displayName.padEnd(24)}
                          </Text>
                          <Text color={statusColor}> {statusLabel.padEnd(10)}</Text>
                          <Text dimColor> {model.description.slice(0, 20).padEnd(20)}</Text>
                          <Text color={COLORS.warning}>{costTier(model.pricing ? model.pricing.inputPer1M + model.pricing.outputPer1M : 0)}</Text>
                          {isSelected && <Text color={COLORS.brand} bold> ◀ selected</Text>}
                          {isActive && !isSelected && <Text color={COLORS.info} bold> ◀ active</Text>}
                          {!isSelectable && <Text dimColor> (not routable)</Text>}
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      )}

      {/* ─── CURRENT (runtime truth) ─── */}
      <Text dimColor>CURRENT</Text>
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>Policy     </Text>
          <Text color={COLORS.brand} bold>{routingMode.toUpperCase()}</Text>
        </Box>
        <Box>
          <Text dimColor>Selected   </Text>
          <Text color={COLORS.text}>{selectedModelId ?? "auto"}</Text>
        </Box>
        {activeModel && (
          <Box>
            <Text dimColor>Active     </Text>
            <Text color={COLORS.text} bold>{activeModel}</Text>
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
        <Text dimColor>
          {tab === "routing" ? "Tab Models" : "Tab Routing"}
          {"   ↑↓ Move   Enter Select   Esc Close (no change)   F2"}
        </Text>
      </Box>
    </Box>
  );
}
