/**
 * ModelPicker — compact, information-dense LiTT Brain selector.
 *
 * Two tabs:
 *   ROUTING — Auto / Fixed / Budget / Max with descriptions
 *   MODELS  — grouped by provider with status, cost, capabilities
 *
 * Design goals:
 *   - Compact (not a giant blank modal)
 *   - Shows ACTIVE model at a glance
 *   - Shows provider + credential source
 *   - Unavailable models shown but not selectable
 *   - Purple brand color (LiTT identity)
 *
 * Keyboard:
 *   Tab      — switch between Routing / Models
 *   ↑↓       — navigate items
 *   Enter    — select (works on all terminals including Windows)
 *   Esc      — close
 *
 * Uses the OverlayManager — no direct useInput call.
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEnter, isEscape, isTab, isUpArrow, isDownArrow } from "./keyboard-utils.js";
import { COLORS, costTier } from "./colors.js";
import { MODEL_CATALOG, type ModelChoice, type RoutingMode } from "../lib/model-routing.js";
import { ProviderRegistry, type DiscoveredModel } from "../lib/provider-registry.js";

export interface ModelPickerProps {
  selectedModelId: string | null;
  routingMode: RoutingMode;
  onSelectModel: (model: ModelChoice) => void;
  onSelectRoutingMode: (mode: RoutingMode) => void;
  onCancel: () => void;
  /** Active model label (what the runtime is actually using) */
  activeModel?: string | null;
  /** Provider source string (e.g. "OpenRouter • BYOK ✓") */
  source?: string;
}

const ROUTING_MODES: { id: RoutingMode; label: string; description: string }[] = [
  { id: "auto", label: "AUTO", description: "LiTT chooses the best engine" },
  { id: "fixed", label: "FIXED", description: "Always use one model" },
  { id: "budget", label: "BUDGET", description: "Lowest-cost capable engine" },
  { id: "max", label: "MAX", description: "Strongest available engine" },
];

export function ModelPicker({
  selectedModelId,
  routingMode,
  onSelectModel,
  onSelectRoutingMode,
  onCancel,
  activeModel,
  source = "OpenRouter • BYOK ✓",
}: ModelPickerProps): React.ReactElement {
  const [tab, setTab] = useState<"routing" | "models">("routing");
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [loading, setLoading] = useState(true);

  // Discover real model availability (async, non-blocking)
  useEffect(() => {
    let cancelled = false;
    const registry = new ProviderRegistry(MODEL_CATALOG);
    registry.refreshAsync();

    const buildDiscovered = () => {
      const statuses = registry.getProviderStatuses();
      return MODEL_CATALOG.map((choice) => {
        for (const status of statuses) {
          const found = status.models.find((m) => m.choice.id === choice.id);
          if (found) return found;
        }
        const openrouter = statuses.find((s) => s.provider.id === "openrouter");
        if (openrouter && (openrouter.health === "ready" || openrouter.health === "unverified")) {
          return { choice, available: true, servedBy: "openrouter", proven: openrouter.health === "ready" };
        }
        const provider = statuses.find((s) =>
          s.provider.label.toLowerCase() === choice.provider.toLowerCase(),
        );
        if (provider && provider.health === "no-key") {
          return {
            choice,
            available: false,
            unavailableReason: `${choice.provider} credential required`,
            servedBy: provider.provider.id,
            proven: false,
          };
        }
        return {
          choice,
          available: false,
          unavailableReason: "No provider credential",
          servedBy: "unknown",
          proven: false,
        };
      });
    };

    setDiscoveredModels(buildDiscovered());
    setLoading(false);

    registry.refresh().then(() => {
      if (!cancelled) setDiscoveredModels(buildDiscovered());
    }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const availableModels = discoveredModels.filter((m) => m.available);
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const activeIdx = availableModels.findIndex((m) => m.choice.id === selectedModelId);
    return activeIdx >= 0 ? activeIdx : 0;
  });
  const [routingIdx, setRoutingIdx] = useState(() => {
    const idx = ROUTING_MODES.findIndex((m) => m.id === routingMode);
    return idx >= 0 ? idx : 0;
  });

  // Keyboard handler — registered with OverlayManager
  // This is the ONLY keyboard handler when this overlay is active.
  // The prompt underneath receives ZERO keyboard events.
  useOverlayKeyboard("model-picker", useCallback((input, key) => {
    if (isTab(key)) {
      setTab((prev) => (prev === "routing" ? "models" : "routing"));
      return;
    }
    if (isEscape(key, input)) {
      onCancel();
      return;
    }

    if (tab === "routing") {
      if (isUpArrow(key)) {
        setRoutingIdx((prev) => Math.max(0, prev - 1));
      } else if (isDownArrow(key)) {
        setRoutingIdx((prev) => Math.min(ROUTING_MODES.length - 1, prev + 1));
      } else if (isEnter(key, input)) {
        onSelectRoutingMode(ROUTING_MODES[routingIdx].id);
      }
    } else {
      if (loading) return;
      if (isUpArrow(key)) {
        setSelectedIdx((prev) => Math.max(0, prev - 1));
      } else if (isDownArrow(key)) {
        setSelectedIdx((prev) => Math.min(availableModels.length - 1, prev + 1));
      } else if (isEnter(key, input)) {
        const model = availableModels[selectedIdx];
        if (model) onSelectModel(model.choice);
      }
    }
  }, [tab, routingIdx, selectedIdx, loading, availableModels, onSelectModel, onSelectRoutingMode, onCancel]));

  // Build the active model display
  const activeLabel = activeModel ?? (selectedModelId
    ? MODEL_CATALOG.find(m => m.id === selectedModelId)?.label ?? "—"
    : "LiTT Auto");

  // Group models by provider for the Models tab
  const providers = [...new Set(MODEL_CATALOG.map((m) => m.provider))];
  let flatIdx = 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      {/* Title bar with tab indicator */}
      <Box marginBottom={1}>
        <Text bold color={COLORS.brand}>LiTT BRAIN</Text>
        <Text dimColor>  </Text>
        <Text color={tab === "routing" ? COLORS.brand : COLORS.secondary} bold={tab === "routing"}>
          {tab === "routing" ? "[Routing]" : " Routing "}
        </Text>
        <Text dimColor>  </Text>
        <Text color={tab === "models" ? COLORS.brand : COLORS.secondary} bold={tab === "models"}>
          {tab === "models" ? "[Models]" : " Models "}
        </Text>
      </Box>

      {/* ─── ROUTING TAB ─── */}
      {tab === "routing" && (
        <Box flexDirection="column">
          {/* Active model summary */}
          <Box marginBottom={1}>
            <Box width={14}><Text dimColor bold>ROUTING</Text></Box>
            <Text color={COLORS.brand} bold>{routingMode.toUpperCase()}</Text>
          </Box>
          <Box marginBottom={1}>
            <Box width={14}><Text dimColor bold>ACTIVE</Text></Box>
            <Text color={COLORS.info} bold>{activeLabel}</Text>
          </Box>

          {/* Routing mode options */}
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
                {isActive && <Text color={COLORS.success}> ✓</Text>}
              </Box>
            );
          })}

          {/* Provider info */}
          <Box marginTop={1}>
            <Text dimColor bold>Provider   </Text>
            <Text color={COLORS.working}>{source}</Text>
          </Box>
        </Box>
      )}

      {/* ─── MODELS TAB ─── */}
      {tab === "models" && !loading && (
        <Box flexDirection="column">
          {providers.map((provider) => (
            <Box key={provider} flexDirection="column">
              <Text dimColor bold>{provider.toUpperCase()}</Text>
              {discoveredModels
                .filter((m) => m.choice.provider === provider)
                .map((model) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIdx;
                  const isActive = model.choice.id === selectedModelId;
                  const isAvailable = model.available;
                  const statusIcon = isAvailable
                    ? (model.proven ? "●" : "?")
                    : "○";
                  const statusLabel = isAvailable
                    ? (model.proven ? "READY" : "UNVERIFIED")
                    : (model.unavailableReason?.includes("credential") ? "NO KEY" : "OFFLINE");
                  const statusColor = isAvailable
                    ? (model.proven ? COLORS.success : COLORS.warning)
                    : COLORS.secondary;

                  return (
                    <Box key={model.choice.id}>
                      <Text color={isSelected && isAvailable ? COLORS.brand : undefined}>
                        {isSelected && isAvailable ? ">" : " "}
                      </Text>
                      <Text
                        color={isSelected && isAvailable ? COLORS.brand : isAvailable ? COLORS.text : COLORS.secondary}
                        bold={isSelected && isAvailable}
                      >
                        {" "}{model.choice.label.padEnd(22)}
                      </Text>
                      <Text color={statusColor}>{statusIcon} {statusLabel.padEnd(10)}</Text>
                      <Text dimColor> {model.choice.description.padEnd(16)}</Text>
                      <Text color={COLORS.warning}>{costTier(model.choice.cost)}</Text>
                      {isActive && <Text color={COLORS.success}> ✓</Text>}
                    </Box>
                  );
                })}
            </Box>
          ))}
        </Box>
      )}

      {tab === "models" && loading && <Text dimColor>Discovering models...</Text>}

      {/* Footer — keyboard help */}
      <Box marginTop={1}>
        <Text dimColor>
          {tab === "routing" ? "Tab Models" : "Tab Routing"}
          {"   ↑↓ Move   Enter Select   Esc Close"}
        </Text>
      </Box>
    </Box>
  );
}
