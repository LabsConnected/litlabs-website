/**
 * CommandPalette — quick action launcher (Ctrl+K).
 *
 * Shows all available slash commands and actions. User navigates
 * with arrow keys and selects with Enter. Esc cancels.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export interface PaletteAction {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
}

export interface CommandPaletteProps {
  actions: PaletteAction[];
  onSelect: (action: PaletteAction) => void;
  onCancel: () => void;
}

export function CommandPalette({ actions, onSelect, onCancel }: CommandPaletteProps): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [query, setQuery] = useState("");

  const filtered = query
    ? actions.filter(a => a.label.toLowerCase().includes(query.toLowerCase()) || a.id.toLowerCase().includes(query.toLowerCase()))
    : actions;

  useInput(useCallback((input, key) => {
    if (key.upArrow) {
      setSelectedIdx(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIdx(prev => Math.min(filtered.length - 1, prev + 1));
    } else if (key.return) {
      if (filtered[selectedIdx]) onSelect(filtered[selectedIdx]);
    } else if (key.escape) {
      onCancel();
    } else if (key.backspace || key.delete) {
      setQuery(prev => prev.slice(0, -1));
      setSelectedIdx(0);
    } else if (input && !key.ctrl && !key.meta && input.length === 1) {
      setQuery(prev => prev + input);
      setSelectedIdx(0);
    }
  }, [filtered, selectedIdx, onSelect, onCancel]));

  // Group by category
  const categories = [...new Set(filtered.map(a => a.category))];
  let flatIdx = 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">COMMAND PALETTE</Text>
        {query && <Text dimColor> — filter: "{query}"</Text>}
      </Box>
      {categories.map(category => (
        <Box key={category} flexDirection="column">
          <Text dimColor bold>{category}</Text>
          {filtered.filter(a => a.category === category).map(action => {
            const idx = flatIdx++;
            const isSelected = idx === selectedIdx;
            return (
              <Box key={action.id}>
                <Text color={isSelected ? "magenta" : undefined}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text color={isSelected ? "magenta" : "white"} bold={isSelected}>
                  {" "}{action.label}
                </Text>
                {action.shortcut && <Text dimColor> ({action.shortcut})</Text>}
              </Box>
            );
          })}
        </Box>
      ))}
      {filtered.length === 0 && <Text dimColor>No matches</Text>}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · type to filter · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}

export const DEFAULT_ACTIONS: PaletteAction[] = [
  { id: "/build", label: "Build project", category: "Project", shortcut: "" },
  { id: "/check", label: "Typecheck", category: "Project" },
  { id: "/test", label: "Run tests", category: "Project" },
  { id: "/verify", label: "Run verification gate", category: "Project" },
  { id: "/diff", label: "Show git diff", category: "Git" },
  { id: "/status", label: "Show git status", category: "Git" },
  { id: "/inspect", label: "Inspect project", category: "Project" },
  { id: "/run", label: "Run arbitrary command", category: "Execution" },
  { id: "/model", label: "Select model", category: "Settings", shortcut: "Ctrl+M" },
  { id: "/mode plan", label: "Switch to PLAN mode", category: "Settings" },
  { id: "/mode act", label: "Switch to ACT mode", category: "Settings" },
  { id: "/mode auto", label: "Switch to AUTO mode", category: "Settings" },
  { id: "/clear", label: "Clear activity", category: "UI" },
  { id: "/help", label: "Show help", category: "UI" },
  { id: "/litt", label: "Return to LiTT conversation", category: "UI" },
  { id: "/exit", label: "Exit cockpit", category: "UI" },
];
