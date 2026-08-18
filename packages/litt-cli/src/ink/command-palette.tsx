/**
 * CommandPalette — LiTT Actions palette (Ctrl+K).
 *
 * Quick action launcher with fuzzy filtering.
 * Purple brand color, LiTT identity.
 *
 * Keyboard:
 *   ↑↓       — navigate
 *   Enter    — select (works on all terminals)
 *   type     — filter
 *   Esc      — close
 *
 * Uses the OverlayManager — no direct useInput call.
 */

import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEnter, isEscape, isUpArrow, isDownArrow, isBackspace, isPrintable } from "./keyboard-utils.js";
import { COLORS } from "./colors.js";

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
    ? actions.filter(a =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        a.id.toLowerCase().includes(query.toLowerCase()))
    : actions;

  // Keyboard handler — registered with OverlayManager
  useOverlayKeyboard("command-palette", useCallback((input, key) => {
    if (isUpArrow(key)) {
      setSelectedIdx(prev => Math.max(0, prev - 1));
    } else if (isDownArrow(key)) {
      setSelectedIdx(prev => Math.min(filtered.length - 1, prev + 1));
    } else if (isEnter(key, input)) {
      if (filtered[selectedIdx]) onSelect(filtered[selectedIdx]);
    } else if (isEscape(key, input)) {
      onCancel();
    } else if (isBackspace(key)) {
      setQuery(prev => prev.slice(0, -1));
      setSelectedIdx(0);
    } else if (isPrintable(input, key)) {
      setQuery(prev => prev + input);
      setSelectedIdx(0);
    }
  }, [filtered, selectedIdx, onSelect, onCancel]));

  const categories = [...new Set(filtered.map(a => a.category))];
  let flatIdx = 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color={COLORS.brand}>LiTT ACTIONS</Text>
        {query && <Text dimColor> — {query}</Text>}
      </Box>

      {/* Actions grouped by category */}
      {categories.map(category => (
        <Box key={category} flexDirection="column">
          {filtered.filter(a => a.category === category).map(action => {
            const idx = flatIdx++;
            const isSelected = idx === selectedIdx;
            return (
              <Box key={action.id}>
                <Text color={isSelected ? COLORS.brand : undefined}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text color={isSelected ? COLORS.brand : COLORS.text} bold={isSelected}>
                  {" "}{action.label}
                </Text>
                {action.shortcut && <Text dimColor> ({action.shortcut})</Text>}
              </Box>
            );
          })}
        </Box>
      ))}

      {filtered.length === 0 && <Text dimColor>No matches</Text>}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · type to filter · Enter select · Esc close</Text>
      </Box>
    </Box>
  );
}

export const DEFAULT_ACTIONS: PaletteAction[] = [
  { id: "/build", label: "Build project", category: "Project" },
  { id: "/debug", label: "Debug — diagnose issue", category: "Project" },
  { id: "/test", label: "Run tests", category: "Project" },
  { id: "/verify", label: "Full verification", category: "Project" },
  { id: "/diff", label: "Show changes", category: "Git" },
  { id: "/status", label: "Runtime/project status", category: "Git" },
  { id: "/model", label: "Quick model switch", category: "Brain", shortcut: "/model" },
  { id: "/models", label: "Model center", category: "Brain", shortcut: "F2" },
  { id: "/route", label: "Routing information", category: "Brain" },
  { id: "/doctor", label: "Diagnose LiTT", category: "System" },
  { id: "/ship", label: "Verify + prepare release", category: "Project" },
  { id: "/clear", label: "Clear activity", category: "UI" },
  { id: "/help", label: "Commands", category: "UI" },
  { id: "/exit", label: "Exit", category: "UI" },
];
