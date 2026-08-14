/**
 * ModelCenter — full model management screen (/models).
 *
 * Shows:
 *   - All providers with connection status
 *   - Default routing per task type
 *   - Credential status
 *
 * This is the "advanced" view. /model is the quick switch.
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { MODEL_CATALOG } from "../lib/model-routing.js";
import type { RoutingMode } from "../lib/model-routing.js";

export interface ModelCenterProps {
  routingMode: RoutingMode;
  selectedModelId: string | null;
  hasApiKey: boolean;
  onCancel: () => void;
}

const TASK_DEFAULTS = [
  { task: "DEFAULT", model: "Auto — LiTT Routing" },
  { task: "CODING", model: "GPT-5.6 Codex" },
  { task: "REASONING", model: "Claude Opus 4.6" },
  { task: "FAST", model: "Claude Sonnet 4.6" },
  { task: "LOCAL", model: "Qwen3-Coder" },
];

export function ModelCenter({ routingMode, selectedModelId, hasApiKey, onCancel }: ModelCenterProps): React.ReactElement {
  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  // Get unique providers with model counts
  const providers = [...new Set(MODEL_CATALOG.map(m => m.provider))].map(provider => {
    const models = MODEL_CATALOG.filter(m => m.provider === provider);
    return {
      name: provider,
      count: models.length,
      connected: provider === "LiTT" || (hasApiKey && provider !== "Local"),
      isLocal: provider === "Local",
    };
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">LiTT MODEL CENTER</Text>
      </Box>

      {/* Providers */}
      <Text dimColor bold>PROVIDERS</Text>
      <Box flexDirection="column" marginBottom={1}>
        {providers.map(p => (
          <Box key={p.name}>
            <Text color={p.connected ? "green" : "gray"}>
              {p.connected ? "✓" : "○"}
            </Text>
            <Text color={p.connected ? "white" : "gray"} bold>
              {" "}{p.name.padEnd(12)}
            </Text>
            <Text dimColor>
              {" "}{p.count} model{p.count !== 1 ? "s" : ""} available
              {p.connected ? "" : " — not configured"}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Task defaults */}
      <Text dimColor bold>TASK ROUTING</Text>
      <Box flexDirection="column" marginBottom={1}>
        {TASK_DEFAULTS.map(td => (
          <Box key={td.task}>
            <Text dimColor bold>{td.task.padEnd(12)}</Text>
            <Text color="cyan"> {td.model}</Text>
          </Box>
        ))}
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
