/**
 * DiffViewer — the /diff overlay.
 *
 *   DIFF
 *
 *   M packages/litt-cli/src/ink/controller.ts
 *   M packages/litt-cli/src/ink/mission-verification.ts
 *
 *   ─────────────────────────────────────────────
 *
 *   controller.ts
 *
 *   - 218 │ const status = await inspectGit();
 *   + 219 │ return status ?? fallback;
 *
 *   [A] Accept   [R] Revert   [O] Open   [Esc] Close
 *
 * Keys:
 *   ↑↓      — navigate files
 *   Enter   — toggle detail diff for the selected file
 *   A       — accept (close, records the review)
 *   R       — revert the selected file (double-confirmed: y/n, then the
 *             gateway's own approval flow)
 *   O       — open in editor
 *   Esc     — close (or back from detail / cancel revert)
 */

import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useOverlayKeyboard } from "../overlay-manager.js";
import { isEnter, isEscape, isUpArrow, isDownArrow } from "../keyboard-utils.js";
import { COLORS } from "../colors.js";
import { getFileDiff, type DiffFileEntry } from "../../lib/diff-view.js";

const STATUS_GLYPH: Record<string, { glyph: string; color: string }> = {
  M: { glyph: "M", color: COLORS.warning },
  A: { glyph: "A", color: COLORS.success },
  D: { glyph: "D", color: COLORS.error },
  R: { glyph: "R", color: COLORS.info },
  C: { glyph: "C", color: COLORS.info },
  U: { glyph: "U", color: COLORS.error },
};

export interface DiffViewerProps {
  cwd: string;
  files: DiffFileEntry[];
  onClose: () => void;
  onRevert: (path: string) => void;
  onOpen: (path: string) => void;
  onAccept: () => void;
}

export function DiffViewer({ cwd, files, onClose, onRevert, onOpen, onAccept }: DiffViewerProps): React.ReactElement {
  const { stdout } = useStdout();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [detailDiff, setDetailDiff] = useState<string | null>(null);

  const selected = files[selectedIdx] ?? null;

  // Fetch the diff text for the detail view (refetched per file — cheap).
  useEffect(() => {
    if (!detail) {
      setDetailDiff(null);
      return;
    }
    setDetailDiff(getFileDiff(cwd, detail));
  }, [detail, cwd]);

  useOverlayKeyboard("diff-viewer", useCallback((input, key) => {
    // Revert confirmation — y/n only.
    if (confirmRevert) {
      if (input === "y" || input === "Y") {
        setConfirmRevert(false);
        if (selected) onRevert(selected.path);
        return;
      }
      if (input === "n" || input === "N" || isEscape(key, input)) {
        setConfirmRevert(false);
        return;
      }
      return;
    }

    if (isEscape(key, input)) {
      if (detail) setDetail(null);
      else onClose();
      return;
    }
    if (detail) {
      // In detail view: Esc back (handled above); Enter back too.
      if (isEnter(key, input)) { setDetail(null); return; }
      return;
    }
    if (isUpArrow(key)) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
    } else if (isDownArrow(key)) {
      setSelectedIdx((prev) => Math.min(files.length - 1, prev + 1));
    } else if (isEnter(key, input)) {
      if (selected) setDetail(selected.path);
    } else if (input === "a" || input === "A") {
      onAccept();
    } else if (input === "r" || input === "R") {
      if (selected) setConfirmRevert(true);
    } else if (input === "o" || input === "O") {
      if (selected) onOpen(selected.path);
    }
  }, [confirmRevert, detail, files, selected, onClose, onRevert, onOpen, onAccept]));

  if (files.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.success} paddingX={2} paddingY={1}>
        <Text bold color={COLORS.success}>DIFF</Text>
        <Text dimColor>No changes. Working tree is clean.</Text>
        <Box marginTop={1}>
          <Text dimColor>Esc close</Text>
        </Box>
      </Box>
    );
  }

  const totalAdded = files.reduce((s, f) => s + f.additions, 0);
  const totalRemoved = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color={COLORS.brand}>DIFF</Text>
        <Text dimColor>
          {files.length} file{files.length !== 1 ? "s" : ""} · <Text color={COLORS.success}>+{totalAdded}</Text> <Text color={COLORS.error}>-{totalRemoved}</Text>
        </Text>
      </Box>

      {detail ? (
        // ── Detail diff for one file ──
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.working} bold>{detail}</Text>
          {detailDiff ? (
            <Box flexDirection="column">
              {detailDiff.split("\n").map((line, i) => {
                const maxLines = Math.max(10, Math.min(28, Math.floor((stdout?.rows ?? 24) / 2)));
                if (i >= maxLines) return null;
                let color: string = COLORS.secondary;
                let bold = false;
                if (line.startsWith("+") && !line.startsWith("+++")) { color = COLORS.success; }
                else if (line.startsWith("-") && !line.startsWith("---")) { color = COLORS.error; }
                else if (line.startsWith("@@")) { color = COLORS.working; bold = true; }
                return (
                  <Text key={i} color={color} bold={bold}>{line}</Text>
                );
              })}
              {detailDiff.split("\n").length > 28 && <Text dimColor>… (truncated)</Text>}
            </Box>
          ) : (
            <Text dimColor>reading diff…</Text>
          )}
          <Box marginTop={1}>
            <Text dimColor>Enter back · Esc close</Text>
          </Box>
        </Box>
      ) : confirmRevert ? (
        // ── Revert confirmation ──
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.warning} bold>REVERT {selected?.path}</Text>
          <Text dimColor>Discards all local changes to this file (git checkout --).</Text>
          <Box marginTop={1}>
            <Text color={COLORS.error} bold>[y]</Text><Text> Revert  </Text>
            <Text color={COLORS.success} bold>[n]</Text><Text> Cancel</Text>
          </Box>
        </Box>
      ) : (
        // ── File list ──
        <Box flexDirection="column" marginTop={1}>
          {files.map((f, idx) => {
            const isSelected = idx === selectedIdx;
            const sg = STATUS_GLYPH[f.status] ?? { glyph: f.status, color: COLORS.secondary };
            return (
              <Box key={f.path}>
                <Text color={isSelected ? COLORS.brand : undefined}>{isSelected ? ">" : " "}</Text>
                <Text color={sg.color} bold>{sg.glyph}</Text>
                <Text color={isSelected ? COLORS.brand : COLORS.text} bold={isSelected}>
                  {` ${f.path}`}
                </Text>
                {f.additions + f.deletions > 0 && (
                  <Text dimColor>{`  +${f.additions} -${f.deletions}`}</Text>
                )}
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text color={COLORS.success} bold>[A]</Text><Text dimColor> Accept  </Text>
            <Text color={COLORS.error} bold>[R]</Text><Text dimColor> Revert  </Text>
            <Text color={COLORS.info} bold>[O]</Text><Text dimColor> Open  </Text>
            <Text dimColor>Enter detail · ↑↓ navigate · Esc close</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
