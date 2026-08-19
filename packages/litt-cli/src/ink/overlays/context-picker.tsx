/**
 * ContextPicker — the @ context picker.
 *
 * Typing `@` in the composer opens this. Attach real context to your
 * request:
 *
 *   @controller.ts            — fuzzy file search (project tree)
 *   @git:changes              — porcelain status
 *   @git:branch               — branch + last commit
 *   @terminal:last            — last captured terminal line
 *   @error:last               — last captured error
 *   @workspace                — the project root path
 *
 * Selecting a file appends `@<relative-path>` to the composer draft;
 * selecting a special token appends the token. The controller resolves
 * them on submit (lib/context-resolver.ts).
 *
 * /files opens this in "files" mode (only the file search).
 */

import React, { useCallback, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "../overlay-manager.js";
import { isEnter, isEscape, isUpArrow, isDownArrow, isBackspace, isPrintable } from "../keyboard-utils.js";
import { COLORS } from "../colors.js";
import { fuzzyScore } from "../command-palette.js";
import { discoverFiles } from "../../lib/file-tree.js";

export type ContextPickerMode = "context" | "files";

export interface ContextPickerProps {
  cwd: string;
  mode?: ContextPickerMode;
  initialQuery?: string;
  onSelect: (token: string) => void;
  onCancel: () => void;
}

interface PickerItem {
  kind: "special" | "file";
  token: string;
  label: string;
  detail: string;
}

const SPECIALS: PickerItem[] = [
  { kind: "special", token: "@git:changes", label: "@git:changes", detail: "working tree status" },
  { kind: "special", token: "@git:branch", label: "@git:branch", detail: "branch + last commit" },
  { kind: "special", token: "@terminal:last", label: "@terminal:last", detail: "last terminal output" },
  { kind: "special", token: "@error:last", label: "@error:last", detail: "last error text" },
  { kind: "special", token: "@workspace", label: "@workspace", detail: "project root path" },
];

export function ContextPicker({ cwd, mode = "context", initialQuery = "", onSelect, onCancel }: ContextPickerProps): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [query, setQuery] = useState(initialQuery);

  // Files are discovered once per open (memoized). The tree walk skips
  // node_modules/.git/dist/build etc. and caps at a sane size.
  const files = useMemo(() => (mode === "context" || mode === "files" ? discoverFiles(cwd, 3000) : []), [cwd, mode]);

  const items = useMemo<PickerItem[]>(() => {
    const q = query.trim();
    const source: PickerItem[] = mode === "files"
      ? files.map((f) => ({ kind: "file" as const, token: `@${f}`, label: `@${f}`, detail: "file" }))
      : [
          ...SPECIALS,
          ...files.map((f) => ({ kind: "file" as const, token: `@${f}`, label: `@${f}`, detail: "file" })),
        ];
    if (!q) return source;
    return source
      .map((item) => ({ item, score: fuzzyScore(q, item.label) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [query, files, mode]);

  useOverlayKeyboard("context-picker", useCallback((input, key) => {
    if (isUpArrow(key)) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
    } else if (isDownArrow(key)) {
      setSelectedIdx((prev) => Math.min(items.length - 1, prev + 1));
    } else if (isEnter(key, input)) {
      if (items[selectedIdx]) onSelect(items[selectedIdx].token);
    } else if (isEscape(key, input)) {
      onCancel();
    } else if (isBackspace(key)) {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIdx(0);
    } else if (isPrintable(input, key)) {
      setQuery((prev) => prev + input);
      setSelectedIdx(0);
    }
  }, [items, selectedIdx, onSelect, onCancel]));

  const visible = items.slice(0, 14);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.brand}>ATTACH CONTEXT</Text>
        <Text dimColor> — </Text>
        <Text color={COLORS.text}>{query}</Text>
      </Box>

      {mode !== "files" && (
        <Box flexDirection="column">
          {visible.filter((i) => i.kind === "special").map((item) => {
            const idx = items.indexOf(item);
            const isSelected = idx === selectedIdx;
            return (
              <Box key={item.token}>
                <Text color={isSelected ? COLORS.brand : undefined}>{isSelected ? ">" : " "}</Text>
                <Text color={isSelected ? COLORS.brand : COLORS.text} bold={isSelected}> {item.label}</Text>
                <Text dimColor>  {item.detail}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box flexDirection="column">
        {visible.filter((i) => i.kind === "file").map((item) => {
          const idx = items.indexOf(item);
          const isSelected = idx === selectedIdx;
          return (
            <Box key={item.token}>
              <Text color={isSelected ? COLORS.brand : undefined}>{isSelected ? ">" : " "}</Text>
              <Text color={isSelected ? COLORS.brand : COLORS.working} dimColor={!isSelected}> {item.label}</Text>
            </Box>
          );
        })}
      </Box>

      {visible.length === 0 && <Text dimColor>No matches</Text>}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · type to filter · Enter attach · Esc close</Text>
      </Box>
    </Box>
  );
}
