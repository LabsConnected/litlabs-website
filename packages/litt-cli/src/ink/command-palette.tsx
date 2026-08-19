/**
 * CommandPalette — the LiTT command palette (/ or Ctrl+K).
 *
 * Grouped by intent (NEW / BUILD / WORKSPACE / LiTT / SHELL), fuzzy
 * filtered as you type, arrow-key navigated, Enter to activate,
 * Esc to close. Every command in the palette is wired in the
 * controller — the palette never executes anything itself.
 *
 * Keyboard (owns all keys while open):
 *   ↑↓       navigate
 *   Enter    select
 *   type     fuzzy filter
 *   Esc      close
 */

import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEnter, isEscape, isUpArrow, isDownArrow, isBackspace, isPrintable } from "./keyboard-utils.js";
import { COLORS } from "./colors.js";

export interface PaletteAction {
  /** The command executed on select (e.g. "/verify"). */
  id: string;
  label: string;
  shortcut?: string;
  /** Display group. */
  group: string;
}

export interface CommandPaletteProps {
  actions: PaletteAction[];
  onSelect: (action: PaletteAction) => void;
  onCancel: () => void;
  /** Seed the filter (e.g. "ver" when opened by typing /ver). */
  initialQuery?: string;
}

/** Fuzzy score: subsequence match, prefix bonus, adjacency bonus. */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.startsWith(q)) return 100 + q.length * 2; // prefix — best
  let ti = 0;
  let score = 0;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === q[qi]) { found = j; break; }
    }
    if (found === -1) return -1;
    score += 10;
    if (found === ti) { consecutive++; score += consecutive; } else { consecutive = 0; }
    ti = found + 1;
  }
  return score;
}

export function CommandPalette({ actions, onSelect, onCancel, initialQuery = "" }: CommandPaletteProps): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [query, setQuery] = useState(initialQuery);

  const filtered = useCallback(() => {
    const q = query.trim();
    if (!q) return actions;
    return actions
      .map((a) => ({ a, score: Math.max(fuzzyScore(q, a.label), fuzzyScore(q, a.id)) }))
      .filter((x) => x.score >= 0)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.a);
  }, [actions, query])();

  useOverlayKeyboard("command-palette", useCallback((input, key) => {
    if (isUpArrow(key)) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
    } else if (isDownArrow(key)) {
      setSelectedIdx((prev) => Math.min(filtered.length - 1, prev + 1));
    } else if (isEnter(key, input)) {
      if (filtered[selectedIdx]) onSelect(filtered[selectedIdx]);
    } else if (isEscape(key, input)) {
      onCancel();
    } else if (isBackspace(key)) {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIdx(0);
    } else if (isPrintable(input, key)) {
      setQuery((prev) => prev + input);
      setSelectedIdx(0);
    }
  }, [filtered, selectedIdx, onSelect, onCancel]));

  // Render grouped; selectedIdx is a flat index across all groups.
  const groups = [...new Set(filtered.map((a) => a.group))];
  let flatIdx = 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.secondaryDim} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.text}>COMMANDS</Text>
        <Text dimColor> — </Text>
        <Text color={COLORS.text}>{query}</Text>
      </Box>

      {groups.map((group) => {
        const items = filtered.filter((a) => a.group === group);
        if (items.length === 0) return null;
        return (
          <Box key={group} flexDirection="column" marginBottom={0}>
            <Text dimColor>{group}</Text>
            {items.map((action) => {
              const idx = flatIdx++;
              const isSelected = idx === selectedIdx;
              return (
                <Box key={action.id}>
                  <Text color={isSelected ? COLORS.brand : COLORS.secondaryDim}>
                    {isSelected ? ">" : " "}
                  </Text>
                  <Text color={isSelected ? COLORS.brand : COLORS.text} bold={isSelected}>
                    {" "}{action.id}
                  </Text>
                  <Text dimColor>  {action.label}</Text>
                  {action.shortcut && <Text dimColor>  ({action.shortcut})</Text>}
                </Box>
              );
            })}
          </Box>
        );
      })}

      {filtered.length === 0 && <Text dimColor>No matches</Text>}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · type to filter · Enter select · Esc close</Text>
      </Box>
    </Box>
  );
}

/** The full command set — every id is handled by the controller. */
export const DEFAULT_ACTIONS: PaletteAction[] = [
  { id: "/new", label: "New conversation", group: "NEW" },
  { id: "/resume", label: "Resume previous session", group: "NEW" },
  { id: "/inspect", label: "Inspect project", group: "BUILD" },
  { id: "/plan", label: "Plan only — read, reason, propose", group: "BUILD", shortcut: "Tab" },
  { id: "/act", label: "Execute — edit, run, ship", group: "BUILD", shortcut: "Tab" },
  { id: "/fix", label: "Diagnose + fix current problem", group: "BUILD" },
  { id: "/verify", label: "Tests · typecheck · build", group: "BUILD" },
  { id: "/diff", label: "Review LiTT changes", group: "BUILD", shortcut: "Ctrl+D" },
  { id: "/ship", label: "Commit / push / deploy", group: "BUILD" },
  { id: "/workspace", label: "Switch project/worktree", group: "WORKSPACE", shortcut: "Ctrl+O" },
  { id: "/branch", label: "Switch/create branch", group: "WORKSPACE" },
  { id: "/files", label: "Find project files", group: "WORKSPACE" },
  { id: "/model", label: "Model routing", group: "LiTT", shortcut: "/model" },
  { id: "/status", label: "Runtime details", group: "LiTT" },
  { id: "/doctor", label: "Diagnose LiTT", group: "LiTT" },
  { id: "/settings", label: "Shell settings", group: "LiTT" },
  { id: "/run", label: "Run arbitrary command", group: "SHELL" },
  { id: "/route", label: "Routing information", group: "SHELL" },
  { id: "/providers", label: "Provider health", group: "SHELL" },
  { id: "/clear", label: "Clear transcript", group: "SHELL", shortcut: "Ctrl+L" },
  { id: "/help", label: "Commands", group: "SHELL", shortcut: "?" },
  { id: "/exit", label: "Exit LiTT", group: "SHELL" },
];
