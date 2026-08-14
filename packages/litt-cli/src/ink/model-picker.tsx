/**
 * ModelPicker — Ink model selector with routing modes.
 *
 * Shows:
 *   - Routing mode selector (Auto, Fixed, Budget, Max)
 *   - Models grouped by provider with descriptions
 *   - Selected model marked with ✓
 *
 * The user talks to LiTT, not "Claude" or "GPT."
 * Ctrl+M opens this picker.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { MODEL_CATALOG, type ModelChoice, type RoutingMode } from "../lib/model-routing.js";

export interface ModelPickerProps {
  selectedModelId: string | null;
  routingMode: RoutingMode;
  onSelectModel: (model: ModelChoice) => void;
  onSelectRoutingMode: (mode: RoutingMode) => void;
  onCancel: () => void;
}

const ROUTING_MODES: { id: RoutingMode; label: string; description: string }[] = [
  { id: "auto", label: "Auto", description: "LiTT chooses best model per task" },
  { id: "fixed", label: "Fixed", description: "Always use selected model" },
  { id: "budget", label: "Budget", description: "Prefer cheapest capable model" },
  { id: "max", label: "Max", description: "Prefer strongest available model" },
];

export function ModelPicker({
  selectedModelId,
  routingMode,
  onSelectModel,
  onSelectRoutingMode,
  onCancel,
}: ModelPickerProps): React.ReactElement {
  const [tab, setTab] = useState<"routing" | "models">("routing");
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const activeIdx = MODEL_CATALOG.findIndex(m => m.id === selectedModelId);
    return activeIdx >= 0 ? activeIdx : 0;
  });
  const [routingIdx, setRoutingIdx] = useState(() => {
    const idx = ROUTING_MODES.findIndex(m => m.id === routingMode);
    return idx >= 0 ? idx : 0;
  });

  useInput(useCallback((_, key) => {
    if (key.tab) {
      setTab(prev => prev === "routing" ? "models" : "routing");
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }

    if (tab === "routing") {
      if (key.upArrow) {
        setRoutingIdx(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setRoutingIdx(prev => Math.min(ROUTING_MODES.length - 1, prev + 1));
      } else if (key.return) {
        onSelectRoutingMode(ROUTING_MODES[routingIdx].id);
      }
    } else {
      if (key.upArrow) {
        setSelectedIdx(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIdx(prev => Math.min(MODEL_CATALOG.length - 1, prev + 1));
      } else if (key.return) {
        onSelectModel(MODEL_CATALOG[selectedIdx]);
      }
    }
  }, [tab, routingIdx, selectedIdx, onSelectModel, onSelectRoutingMode, onCancel]));

  // Group models by provider
  const providers = [...new Set(MODEL_CATALOG.map(m => m.provider))];
  let flatIdx = 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">SELECT LiTT BRAIN</Text>
      </Box>

      {/* Tab indicator */}
      <Box marginBottom={1}>
        <Text color={tab === "routing" ? "magenta" : "gray"} bold={tab === "routing"}>
          [Routing]{tab === "routing" ? " ◀" : ""}
        </Text>
        <Text dimColor>  </Text>
        <Text color={tab === "models" ? "magenta" : "gray"} bold={tab === "models"}>
          [Models]{tab === "models" ? " ◀" : ""}
        </Text>
      </Box>

      {/* Routing tab */}
      {tab === "routing" && (
        <Box flexDirection="column">
          {ROUTING_MODES.map((mode, idx) => {
            const isSelected = idx === routingIdx;
            const isActive = mode.id === routingMode;
            return (
              <Box key={mode.id}>
                <Text color={isSelected ? "magenta" : undefined}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text color={isSelected ? "magenta" : "white"} bold={isSelected}>
                  {" "}{mode.label.padEnd(10)}
                </Text>
                {isActive && <Text color="green"> ✓ ACTIVE</Text>}
                <Text dimColor>  {mode.description}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Models tab */}
      {tab === "models" && (
        <Box flexDirection="column">
          {providers.map(provider => (
            <Box key={provider} flexDirection="column">
              <Text dimColor bold>{provider.toUpperCase()}</Text>
              {MODEL_CATALOG.filter(m => m.provider === provider).map(model => {
                const idx = flatIdx++;
                const isSelected = idx === selectedIdx;
                const isActive = model.id === selectedModelId;
                const isRecommended = model.id === "openrouter/auto";
                return (
                  <Box key={model.id}>
                    <Text color={isSelected ? "magenta" : undefined}>
                      {isSelected ? ">" : " "}
                    </Text>
                    <Text color={isSelected ? "magenta" : "white"} bold={isSelected}>
                      {" "}{model.label.padEnd(30)}
                    </Text>
                    <Text dimColor> {model.description}</Text>
                    {isActive && <Text color="green"> ✓</Text>}
                    {isRecommended && <Text color="yellow"> ★ BEST</Text>}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Tab switch · ↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}
