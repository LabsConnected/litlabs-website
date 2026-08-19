/**
 * ModelPicker — compact, information-dense LiTT Brain selector.
 *
 * Two tabs:
 *   ROUTING — Auto / Fixed / Budget / Max with descriptions
 *   MODELS  — grouped by provider with status, cost, capabilities
 *
 * Uses ModelRuntime (@litt/models) for real discovery + truth.
 * Replaces the legacy ProviderRegistry + model-routing imports.
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
import { ModelRuntime } from "../lib/model-runtime.js";
import type { ModelDefinition, ProviderId } from "@litt/models";
import type { RoutingMode, ModelChoice } from "../lib/model-routing.js";

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
  /** Injected ModelRuntime (shared with controller). Optional. */
  modelRuntime?: ModelRuntime;
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
  modelRuntime: injectedRuntime,
}: ModelPickerProps): React.ReactElement {
  const [tab, setTab] = useState<"routing" | "models">("routing");
  // Stable runtime for the picker's lifetime — the injected shared
  // ModelRuntime when provided, otherwise a picker-local instance.
  const [runtime] = useState(() => injectedRuntime ?? new ModelRuntime());

  const [allModels, setAllModels] = useState<ModelDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  // Discover real model availability (async, non-blocking)
  useEffect(() => {
    let cancelled = false;
    // Show cached immediately
    setAllModels(runtime.getAllModels());
    setLoading(false);
    // Refresh in background
    runtime.refresh().then(() => {
      if (!cancelled) setAllModels(runtime.getAllModels());
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [runtime]);

  const availableModels = allModels.filter((m) => m.availability === "online" || m.availability === "unverified");
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const activeIdx = availableModels.findIndex((m) => m.canonicalId === selectedModelId);
    return activeIdx >= 0 ? activeIdx : 0;
  });
  const [routingIdx, setRoutingIdx] = useState(() => {
    const idx = ROUTING_MODES.findIndex((m) => m.id === routingMode);
    return idx >= 0 ? idx : 0;
  });

  // Keyboard handler — registered with OverlayManager
  const KEY_DEBUG = process.env.LITT_KEY_DEBUG === "1";
  useOverlayKeyboard("model-picker", useCallback((input, key) => {
    if (KEY_DEBUG) {
      process.stderr.write(`[KEY] model-picker input=${JSON.stringify(input)} return=${key.return} escape=${key.escape} tab=${key.tab} up=${key.upArrow} down=${key.downArrow} ctrl=${key.ctrl} currentTab=${tab}\n`);
    }
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
        if (model) {
          // Adapt to the ModelChoice shape the controller expects
          onSelectModel({
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
  }, [tab, routingIdx, selectedIdx, loading, availableModels, onSelectModel, onSelectRoutingMode, onCancel]));

  // Build the active model display
  const activeLabel = activeModel ?? (selectedModelId
    ? runtime.getLabel(selectedModelId)
    : "LiTT Auto");

  // Group models by provider for the Models tab
  const providers = [...new Set(allModels.map((m) => m.provider))];
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
              {allModels
                .filter((m) => m.provider === provider)
                .map((model) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIdx;
                  const isActive = model.canonicalId === selectedModelId;
                  const isOnline = model.availability === "online";
                  const isOffline = model.availability === "offline";
                  const isRoutable = runtime.isRoutable(model.canonicalId);
                  const statusIcon = isOnline ? "●" : isOffline ? "✗" : "?";
                  const statusLabel = isOnline ? "READY" : isOffline ? "OFFLINE" : "UNVERIFIED";
                  const statusColor = isOnline ? COLORS.success : isOffline ? COLORS.error : COLORS.warning;
                  const isSelectable = isOnline || (!isOffline && isRoutable);

                  return (
                    <Box key={model.canonicalId}>
                      <Text color={isSelected && isSelectable ? COLORS.brand : undefined}>
                        {isSelected && isSelectable ? ">" : " "}
                      </Text>
                      <Text
                        color={isSelected && isSelectable ? COLORS.brand : isSelectable ? COLORS.text : COLORS.secondary}
                        bold={isSelected && isSelectable}
                      >
                        {" "}{model.displayName.padEnd(22)}
                      </Text>
                      <Text color={statusColor}>{statusIcon} {statusLabel.padEnd(10)}</Text>
                      <Text dimColor> {model.description.slice(0, 16).padEnd(16)}</Text>
                      <Text color={COLORS.warning}>{costTier(model.pricing ? model.pricing.inputPer1M + model.pricing.outputPer1M : 0)}</Text>
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
