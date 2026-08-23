/**
 * ShipFlow — the /ship overlay.
 *
 *   SHIP
 *
 *   Branch      feat/litt-shell-phase1
 *   Changes     6 files · +292 -96
 *
 *   Verification
 *     ✓ agent-core       500 passed
 *     ✓ litt-cli         333 passed
 *     ✓ typecheck        passed
 *     ✓ build            passed
 *
 *   Suggested commit
 *     feat(cli): introduce focused LiTT shell
 *
 *   [C] Commit   [P] Commit + Push   [E] Edit message   [R] Review   [Esc] Cancel
 *
 * The verification gate is the runtime's own truth boundary — the ship
 * decision is proven, never claimed. Commit/push execute through the
 * canonical gateway.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "../overlay-manager.js";
import { isEnter, isEscape, isBackspace, isPrintable } from "../keyboard-utils.js";
import { COLORS } from "../colors.js";
import type { DiffFileEntry } from "../../lib/diff-view.js";
import type { VerificationResult } from "@litt/agent-core";

export interface ShipFlowProps {
  cwd: string;
  project: string;
  branch: string;
  files: DiffFileEntry[];
  suggestedMessage: string;
  onVerify: () => Promise<VerificationResult>;
  onCommit: (message: string, push: boolean) => Promise<{ ok: boolean; message: string }>;
  onReview: () => void;
  onClose: () => void;
}

type Phase = "verifying" | "ready" | "blocked" | "committing" | "done" | "error";

export function ShipFlow({
  project, branch, files, suggestedMessage,
  onVerify, onCommit, onReview, onClose,
}: ShipFlowProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("verifying");
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [message, setMessage] = useState(suggestedMessage);
  const [editing, setEditing] = useState(false);
  const [resultText, setResultText] = useState("");

  // Run the verification gate once on open — the honest ship gate.
  useEffect(() => {
    let cancelled = false;
    onVerify()
      .then((result) => {
        if (cancelled) return;
        setVerification(result);
        // The gate is the truth boundary: commit keys only appear when
        // the verification PROVEN the work. An unproven result enters
        // "blocked" — commit stays disabled until issues are fixed.
        setPhase(result.proven ? "ready" : "blocked");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResultText(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doCommit = useCallback((push: boolean) => {
    // Belt-and-suspenders UI guard: never commit an unproven ship.
    if (!verification?.proven) return;
    setPhase("committing");
    onCommit(message.trim(), push)
      .then((result) => {
        setResultText(result.message);
        setPhase(result.ok ? "done" : "error");
      })
      .catch((err: unknown) => {
        setResultText(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });
  }, [message, onCommit, verification]);

  useOverlayKeyboard("ship", useCallback((input, key) => {
    // Editing the commit message — printable input appends.
    if (editing) {
      if (isEscape(key, input) || isEnter(key, input)) {
        setEditing(false);
      } else if (isBackspace(key, input)) {
        setMessage((prev) => prev.slice(0, -1));
      } else if (isPrintable(input, key)) {
        setMessage((prev) => prev + input);
      }
      return;
    }

    if (phase === "done" || phase === "error" || phase === "blocked") {
      if (isEscape(key, input) || isEnter(key, input)) onClose();
      return;
    }

    if (isEscape(key, input)) { onClose(); return; }

    if (phase !== "ready") return;

    if (input === "c" || input === "C") doCommit(false);
    else if (input === "p" || input === "P") doCommit(true);
    else if (input === "e" || input === "E") setEditing(true);
    else if (input === "r" || input === "R") onReview();
  }, [editing, phase, doCommit, onClose, onReview]));

  const totalAdded = files.reduce((s, f) => s + f.additions, 0);
  const totalRemoved = files.reduce((s, f) => s + f.deletions, 0);
  const checks = verification?.checks ?? [];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.secondaryDim} paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color={COLORS.text}>SHIP</Text>
        <Text dimColor>{project}</Text>
      </Box>

      {/* Branch + changes */}
      <Box marginTop={1}>
        <Text dimColor>Branch   </Text>
        <Text color={COLORS.secondaryBright}>{branch}</Text>
      </Box>
      <Box>
        <Text dimColor>Changes  </Text>
        <Text>
          {files.length} file{files.length !== 1 ? "s" : ""}
          {files.length > 0 && <> · <Text color={COLORS.success}>+{totalAdded}</Text> <Text color={COLORS.error}>-{totalRemoved}</Text></>}
        </Text>
      </Box>

      {/* Verification — the honest ship gate, no ambiguous state */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Verification</Text>
        {phase === "verifying" && <Text color={COLORS.working}>◉ Running verification…</Text>}
        {verification && verification.proven && (
          <Text color={COLORS.success} bold>✓ Verification proven</Text>
        )}
        {verification && !verification.proven && (
          <Text color={COLORS.error} bold>× Verification not proven</Text>
        )}
        {verification && checks.map((c) => (
          <Box key={c.id}>
            <Text color={c.status === "success" ? COLORS.success : c.status === "failed" ? COLORS.error : COLORS.secondary}>
              {c.status === "success" ? "✓" : c.status === "failed" ? "×" : "·"}
            </Text>
            <Text dimColor={c.status !== "failed"}> {c.id}</Text>
            {c.status === "failed" && <Text color={COLORS.error}>  {c.message}</Text>}
          </Box>
        ))}
      </Box>

      {/* Suggested commit */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{editing ? "Commit message (edit)" : "Suggested commit"}</Text>
        <Text color={COLORS.text} bold>
          {message}{editing ? "▌" : ""}
        </Text>
      </Box>

      {/* Result */}
      {phase === "committing" && (
        <Box marginTop={1}>
          <Text color={COLORS.working}>◉ Committing…</Text>
        </Box>
      )}
      {(phase === "done" || phase === "error") && (
        <Box marginTop={1}>
          <Text color={phase === "done" ? COLORS.success : COLORS.error} bold>
            {phase === "done" ? "✓ " : "× "}{resultText}
          </Text>
        </Box>
      )}

      {/* Actions — commit keys exist ONLY when verification is proven */}
      <Box marginTop={1}>
        {phase === "ready" && !editing && (
          <>
            <Text color={COLORS.success} bold>[C]</Text><Text dimColor> Commit  </Text>
            <Text color={COLORS.success} bold>[P]</Text><Text dimColor> Commit + Push  </Text>
            <Text color={COLORS.warning} bold>[E]</Text><Text dimColor> Edit  </Text>
            <Text color={COLORS.info} bold>[R]</Text><Text dimColor> Review  </Text>
            <Text dimColor>Esc Cancel</Text>
          </>
        )}
        {editing && <Text dimColor>type to edit · Enter/Esc done</Text>}
        {phase === "blocked" && (
          <Box flexDirection="column">
            <Text color={COLORS.error}>× Verification not proven — Commit disabled</Text>
            <Text dimColor>Fix issues, then re-open /ship to re-verify. Enter/Esc close</Text>
          </Box>
        )}
        {(phase === "done" || phase === "error") && <Text dimColor>Enter/Esc close</Text>}
        {phase === "verifying" && <Text dimColor>verification running…</Text>}
      </Box>
    </Box>
  );
}
