/**
 * WorkspacePicker — the /workspace overlay.
 *
 * Lists switchable workspaces: git worktrees of the current repo,
 * sibling project dirs, and configured dirs (~/.litt/workspaces.json).
 * Selecting one switches the shell's workspace context live — no
 * restart (RuntimeSession.setCwd re-binds the gateway/executor).
 *
 * Keys: ↑↓ select · Enter open · Esc close
 */

import React, { useCallback, useState } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "../overlay-manager.js";
import { isEnter, isEscape, isUpArrow, isDownArrow } from "../keyboard-utils.js";
import { COLORS } from "../colors.js";
import type { WorkspaceEntry } from "../../lib/workspace-store.js";

const SOURCE_LABEL: Record<string, string> = {
  worktree: "worktree",
  sibling: "project",
  configured: "configured",
};

export interface WorkspacePickerProps {
  workspaces: WorkspaceEntry[];
  onSelect: (entry: WorkspaceEntry) => void;
  onCancel: () => void;
}

export function WorkspacePicker({ workspaces, onSelect, onCancel }: WorkspacePickerProps): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useOverlayKeyboard("workspace-picker", useCallback((input, key) => {
    if (isUpArrow(key)) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
    } else if (isDownArrow(key)) {
      setSelectedIdx((prev) => Math.min(workspaces.length - 1, prev + 1));
    } else if (isEnter(key, input)) {
      if (workspaces[selectedIdx]) onSelect(workspaces[selectedIdx]);
    } else if (isEscape(key, input)) {
      onCancel();
    }
  }, [workspaces, selectedIdx, onSelect, onCancel]));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.brand}>WORKSPACES</Text>
      </Box>

      {workspaces.length === 0 ? (
        <Text dimColor>No other workspaces found.</Text>
      ) : (
        workspaces.map((ws, idx) => {
          const isSelected = idx === selectedIdx;
          const dirty = ws.changed + ws.untracked > 0;
          return (
            <Box key={ws.root}>
              <Text color={isSelected ? COLORS.brand : undefined}>{isSelected ? ">" : " "}</Text>
              <Text color={ws.current ? COLORS.success : isSelected ? COLORS.brand : COLORS.text} bold={isSelected || ws.current}>
                {ws.current ? "● " : "  "}{ws.name}
              </Text>
              {ws.branch && <Text color={COLORS.warning} dimColor={!isSelected}>  {ws.branch}</Text>}
              <Text dimColor>  [{SOURCE_LABEL[ws.source]}]</Text>
              {dirty && <Text color={COLORS.warning} dimColor={!isSelected}>{`  +${ws.changed + ws.untracked}`}</Text>}
              {ws.current && <Text dimColor>  (current)</Text>}
            </Box>
          );
        })
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ select · Enter open · Esc close</Text>
      </Box>
    </Box>
  );
}
