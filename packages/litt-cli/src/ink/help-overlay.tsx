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
  ["Tab", "Agents (soon — no agent registry yet)"],
  ["Ctrl+P", "Command palette"],
  ["Ctrl+K", "Model selector"],
  ["Ctrl+L", "Activity / log view"],
  ["Ctrl+O", "Context / files (soon)"],
  ["Esc", "Close overlay OR cancel active run"],
  ["Ctrl+C", "Cancel current run (exit when idle)"],
  ["Ctrl+D", "Exit when idle"],
  ["?", "This help screen"],
  ["↑ / ↓", "Input history (or picker navigation)"],
];

const COMMANDS: Array<[string, string]> = [
  ["/build", "Build project"],
  ["/check", "Typecheck"],
  ["/test", "Run tests"],
  ["/verify", "Runtime truth gate"],
  ["/diff", "Show git diff"],
  ["/status", "Runtime + project status"],
  ["/run", "Run arbitrary command"],
  ["/model", "Quick model switch"],
  ["/models", "Model center"],
  ["/route", "Routing information"],
  ["/activity", "Full activity log"],
  ["/clear", "Clear activity"],
  ["/help", "This help screen"],
  ["/exit", "Exit cockpit"],
];

export interface HelpOverlayProps {
  onCancel: () => void;
}

export function HelpOverlay({ onCancel }: HelpOverlayProps): React.ReactElement {
  useOverlayKeyboard("help", useCallback((input: string, key: KeyInfo) => {
    if (isEnter(key, input) || isEscape(key, input) || input === "?") onCancel();
  }, [onCancel]));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={1}>
      <Text bold color={COLORS.brand}>{" LiTT — Help "}</Text>
      <Text dimColor>{"─".repeat(44)}</Text>

      <Text bold color={COLORS.working}>{" Controls"}</Text>
      {CONTROLS.map(([key, desc]) => (
        <Box key={key}>
          <Text color={COLORS.info}>{key.padEnd(10)}</Text>
          <Text dimColor>{`  ${desc}`}</Text>
        </Box>
      ))}

      <Text dimColor>{"─".repeat(44)}</Text>
      <Text bold color={COLORS.working}>{" Slash Commands"}</Text>
      {COMMANDS.map(([cmd, desc]) => (
        <Box key={cmd}>
          <Text color={COLORS.brand}>{cmd.padEnd(12)}</Text>
          <Text dimColor>{`  ${desc}`}</Text>
        </Box>
      ))}

      <Text dimColor>{"─".repeat(44)}</Text>
      <Text dimColor>{" Esc / Enter / ? to close"}</Text>
    </Box>
  );
}
