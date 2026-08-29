/**
 * HelpOverlay — the `?` help screen (spec §16).
 *
 * Lists all keyboard controls and slash commands. Closes on Esc/Enter/?.
 * Deferred features (Tab agents, Ctrl+O context) are marked "(soon)"
 * because the runtime does not yet provide an agent registry or context
 * selector — no fabricated capabilities (spec §5/§21).
 */

import React, { useCallback } from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEnter, isEscape, type KeyInfo } from "./keyboard-utils.js";

const CONTROLS: Array<[string, string]> = [
  ["/ or Ctrl+K", "Command palette"],
  ["@", "Context picker"],
  ["Tab", "Plan / Act toggle"],
  ["F2", "Model center"],
  ["Ctrl+L", "Clear transcript"],
  ["Ctrl+N", "New session"],
  ["Ctrl+R", "Resume session"],
  ["Ctrl+O", "Toggle execution details"],
  ["Ctrl+D", "Diff view"],
  ["Esc", "Close overlay / stop working"],
  ["Ctrl+C", "Cancel run (exit when idle)"],
  ["↑ / ↓", "Input history (or picker navigation)"],
  ["?", "This help screen"],
];

const COMMANDS: Array<[string, string]> = [
  ["/new", "New conversation"],
  ["/resume", "Resume previous session"],
  ["/inspect", "Inspect project"],
  ["/fix", "Diagnose + fix"],
  ["/plan", "Plan only — read-only"],
  ["/act", "Act — full execution"],
  ["/verify", "Runtime truth gate"],
  ["/diff", "Review changes"],
  ["/ship", "Commit / push"],
  ["/workspace", "Switch project"],
  ["/branch", "Switch/create branch"],
  ["/files", "Find project files"],
  ["/model", "Quick model switch"],
  ["/models", "Model center"],
  ["/status", "Runtime details"],
  ["/doctor", "Diagnose LiTT"],
  ["/run", "Run arbitrary command"],
  ["/clear", "Clear transcript"],
  ["/exit", "Exit LiTT"],
];

export interface HelpOverlayProps {
  onCancel: () => void;
}

export function HelpOverlay({ onCancel }: HelpOverlayProps): React.ReactElement {
  useOverlayKeyboard("help", useCallback((input: string, key: KeyInfo) => {
    if (isEnter(key, input) || isEscape(key, input) || input === "?") onCancel();
  }, [onCancel]));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.secondaryDim} paddingX={2} paddingY={1}>
      <Text bold color={COLORS.text}>LiTT — Help</Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Controls</Text>
        {CONTROLS.map(([key, desc]) => (
          <Box key={key}>
            <Text color={COLORS.info}>{key.padEnd(10)}</Text>
            <Text dimColor>{`  ${desc}`}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Slash Commands</Text>
        {COMMANDS.map(([cmd, desc]) => (
          <Box key={cmd}>
            <Text color={COLORS.text} bold>{cmd.padEnd(12)}</Text>
            <Text dimColor>{`  ${desc}`}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Esc / Enter / ? to close</Text>
      </Box>
    </Box>
  );
}
