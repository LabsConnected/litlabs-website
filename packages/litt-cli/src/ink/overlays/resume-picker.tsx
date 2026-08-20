/**
 * ResumePicker — the /resume overlay.
 *
 * Recent LiTT sessions (persisted via lib/session-store.ts). Selecting
 * one restores the transcript, workspace, branch, mode, and model route.
 *
 * Keys: ↑↓ select · Enter restore · Esc close
 */

import React, { useCallback, useState } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "../overlay-manager.js";
import { isEnter, isEscape, isUpArrow, isDownArrow } from "../keyboard-utils.js";
import { COLORS } from "../colors.js";
import { timeAgo, type SessionSnapshot } from "../../lib/session-store.js";

export interface ResumePickerProps {
  sessions: SessionSnapshot[];
  onSelect: (session: SessionSnapshot) => void;
  onCancel: () => void;
}

export function ResumePicker({ sessions, onSelect, onCancel }: ResumePickerProps): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useOverlayKeyboard("resume-picker", useCallback((input, key) => {
    if (isUpArrow(key)) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
    } else if (isDownArrow(key)) {
      setSelectedIdx((prev) => Math.min(sessions.length - 1, prev + 1));
    } else if (isEnter(key, input)) {
      if (sessions[selectedIdx]) onSelect(sessions[selectedIdx]);
    } else if (isEscape(key, input)) {
      onCancel();
    }
  }, [sessions, selectedIdx, onSelect, onCancel]));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.brand}>RECENT</Text>
      </Box>

      {sessions.length === 0 ? (
        <Text dimColor>No saved sessions yet. Run a conversation and it will be saved here.</Text>
      ) : (
        sessions.slice(0, 10).map((s, idx) => {
          const isSelected = idx === selectedIdx;
          return (
            <Box key={s.id}>
              <Text color={isSelected ? COLORS.brand : undefined}>{isSelected ? ">" : " "}</Text>
              <Text color={COLORS.success} bold={isSelected}>{timeAgo(s.updatedAt).padEnd(4)}</Text>
              <Text color={isSelected ? COLORS.brand : COLORS.text} bold={isSelected}>  {s.summary}</Text>
            </Box>
          );
        })
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ select · Enter restore · Esc close</Text>
      </Box>
    </Box>
  );
}
