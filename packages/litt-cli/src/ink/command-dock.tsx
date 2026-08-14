/**
 * CommandDock — command input with history and autocomplete.
 *
 * Natural-language input and /commands both route through the same
 * ExecutionGateway. The CommandDock NEVER executes anything itself.
 * It collects user intent and passes it to the controller.
 *
 * Features:
 *   - Text input with cursor
 *   - History navigation (↑ ↓)
 *   - Slash command autocomplete
 *   - Natural-language agent requests
 *   - No direct shell execution
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

const SLASH_COMMANDS = [
  "/build", "/check", "/test", "/verify", "/diff", "/status", "/inspect",
  "/run", "/ask", "/explain", "/doctor", "/clear", "/help",
  "/model", "/litt", "/palette",
  "/mode plan", "/mode act", "/mode auto",
  "/exit", "/quit",
];

export interface CommandDockProps {
  history: string[];
  onSubmit: (input: string) => void;
  onNavigateHistory: (direction: "up" | "down") => string | null;
  disabled?: boolean;
  prompt?: string;
}

export function CommandDock({
  history,
  onSubmit,
  onNavigateHistory,
  disabled = false,
  prompt = "litt ❯",
}: CommandDockProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  const handleSubmit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    setShowAutocomplete(false);
  }, [onSubmit, disabled]);

  useInput(useCallback((input, key) => {
    if (disabled) return;
    if (key.upArrow) {
      const prev = onNavigateHistory("up");
      if (prev !== null) setValue(prev);
    } else if (key.downArrow) {
      const next = onNavigateHistory("down");
      if (next !== null) setValue(next);
    } else if (input === "/" && value === "") {
      setShowAutocomplete(true);
    } else if (key.escape) {
      setShowAutocomplete(false);
      setValue("");
    }
  }, [disabled, onNavigateHistory, value]));

  const matches = value.startsWith("/")
    ? SLASH_COMMANDS.filter((cmd) => cmd.startsWith(value) && cmd !== value)
    : [];

  return (
    <Box flexDirection="column" marginTop={1}>
      {showAutocomplete && matches.length > 0 && (
        <Box flexDirection="column" marginBottom={0}>
          {matches.slice(0, 5).map((cmd) => (
            <Text key={cmd} color="cyan" dimColor>{cmd}</Text>
          ))}
        </Box>
      )}
      <Box>
        <Text color="magenta" bold>{prompt} </Text>
        {disabled ? (
          <Text dimColor>processing...</Text>
        ) : (
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="Ask LiTT or type / for commands"
          />
        )}
      </Box>
      {history.length > 0 && !disabled && (
        <Text dimColor> ↑↓ history · / for commands · Esc to clear</Text>
      )}
    </Box>
  );
}
