/**
 * StatusBar — bottom status bar, single compact line.
 *
 * Target (wide):
 *   ● LOCAL · IDLE · Auto → Sonnet 4.6 · OpenRouter
 *   Ctrl+M Models · Ctrl+K Actions · Ctrl+C Cancel
 *
 * Target (narrow):
 *   ● LOCAL · IDLE · Sonnet 4.6
 *   Ctrl+M · Ctrl+K · Ctrl+C
 *
 * No wrapping. Model name is shortened (strip provider prefix).
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS, stateColor } from "./colors.js";
import type { HoloState } from "./cockpit-store.js";

export interface StatusBarProps {
  connected: boolean;
  localRuntime: string;
  remoteRuntime: string;
  cwd: string;
  holoState: HoloState;
  brain: string;
  activeModel: string | null;
  runId: string | null;
}

/** Shorten model name: "anthropic/claude-sonnet-4.6" → "Sonnet 4.6" */
function shortModelName(model: string | null): string {
  if (!model) return "";
  // Strip provider prefix
  const withoutProvider = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  // Common replacements
  const cleaned = withoutProvider
    .replace(/^claude-/, "Claude ")
    .replace(/^gpt-/, "GPT-")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^o1-/, "o1 ")
    .replace(/^o3-/, "o3 ")
    .replace(/-/g, " ");
  // Title case the first word
  return cleaned.replace(/\b\w/, (c) => c.toUpperCase());
}

export function StatusBar({
  localRuntime, remoteRuntime, holoState, brain, activeModel,
}: StatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const narrow = width < 60;

  const localIcon = localRuntime === "ready" ? "●" : "○";
  const localColor = localRuntime === "ready" ? COLORS.success : COLORS.warning;
  // Cloud: ● only when connected. ○ when offline — semantically hollow.
  // Dim the entire cloud segment when offline so it reads as inactive.
  const cloudConnected = remoteRuntime === "connected";
  const cloudIcon = cloudConnected ? "●" : "○";
  const cloudColor = cloudConnected ? COLORS.success : COLORS.secondary;
  const sColor = stateColor(holoState);
  const modelShort = shortModelName(activeModel);

  // Calculate available width for model name — never wrap
  // Fixed parts: "● LOCAL READY · " = ~16 chars, holoState ~12 chars
  const fixedPartLen = 16 + (narrow ? 0 : 14) + String(holoState).length + 3;
  const modelMaxLen = Math.max(8, width - fixedPartLen - 4);
  const modelDisplay = modelShort
    ? (modelShort.length > modelMaxLen ? modelShort.slice(0, modelMaxLen - 1) + "…" : modelShort)
    : "";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"─".repeat(Math.min(width, 60))}</Text>
      {/* Line 1: status — fits in one line, never wraps */}
      <Box>
        <Text color={localColor}>{localIcon}</Text>
        <Text dimColor> LOCAL </Text>
        <Text color={localColor}>{localRuntime === "ready" ? "READY" : localRuntime.toUpperCase()}</Text>
        <Text dimColor> · </Text>
        <Text color={cloudColor}>{cloudIcon}</Text>
        {!narrow && <Text dimColor> CLOUD </Text>}
        {!narrow && <Text color={cloudColor}>{remoteRuntime === "connected" ? "ONLINE" : "OFFLINE"}</Text>}
        {!narrow && <Text dimColor> · </Text>}
        <Text color={sColor}>{holoState}</Text>
        {modelDisplay && <Text dimColor> · </Text>}
        {modelDisplay && <Text color={COLORS.info}>{modelDisplay}</Text>}
      </Box>
      {/* Line 2: keyboard help — compact */}
      <Text dimColor>
        {narrow
          ? "Ctrl+M · Ctrl+K · Ctrl+C · Esc"
          : "Ctrl+M Models · Ctrl+K Actions · Ctrl+C Cancel · Esc Close"}
      </Text>
    </Box>
  );
}
