/**
 * CommandDock — command input with history and slash autocomplete.
 *
 * Natural-language input and /commands both route through the same
 * ExecutionGateway. The CommandDock NEVER executes anything itself.
 *
 * Keyboard ownership:
 *   The CommandDock owns Enter when no overlay is open.
 *   We do NOT rely on ink-text-input's onSubmit because it only
 *   checks key.return, which is not always set on Windows Terminal.
 *   Instead, we intercept Enter in our own useInput via isEnter()
 *   which checks key.return, key.enter, AND raw \r / \n.
 *
 *   A submitRef avoids stale closure bugs.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { isUpArrow, isDownArrow, isEscape, isEnter, isTab, type KeyInfo } from "./keyboard-utils.js";
import { COLORS } from "./colors.js";

interface SlashCommand {
  cmd: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/build", description: "Build project" },
  { cmd: "/debug", description: "Diagnose issue" },
  { cmd: "/test", description: "Run tests" },
  { cmd: "/verify", description: "Full verification" },
  { cmd: "/diff", description: "Show changes" },
  { cmd: "/status", description: "Runtime/project status" },
  { cmd: "/inspect", description: "Inspect project" },
  { cmd: "/run", description: "Run arbitrary command" },
  { cmd: "/model", description: "Quick model switch" },
  { cmd: "/models", description: "Model center" },
  { cmd: "/route", description: "Routing information" },
  { cmd: "/doctor", description: "Diagnose LiTT" },
  { cmd: "/ship", description: "Verify + prepare release" },
  { cmd: "/clear", description: "Clear activity" },
  { cmd: "/help", description: "Commands" },
  { cmd: "/exit", description: "Exit cockpit" },
];

const KEY_DEBUG = process.env.LITT_KEY_DEBUG === "1";

export interface CommandDockProps {
  history: string[];
  onSubmit: (input: string) => void;
  onNavigateHistory: (direction: "up" | "down") => string | null;
  onDebugKey?: (info: string) => void;
  disabled?: boolean;
  prompt?: string;
}

export function CommandDock({
  history,
  onSubmit,
  onNavigateHistory,
  onDebugKey,
  disabled = false,
  prompt = "litt ❯",
}: CommandDockProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [acOpen, setAcOpen] = useState(false);
  const [acIdx, setAcIdx] = useState(0);

  // submitRef avoids stale closure bugs — the ref always points to
  // the latest onSubmit, so the useInput callback (which is stable)
  // always calls the current version.
  const submitRef = useRef(onSubmit);
  useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);

  // valueRef so the stable useInput callback can read the current value
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  // disabledRef for the same reason
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  // acOpenRef + acIdxRef + matchesRef for autocomplete state
  const acOpenRef = useRef(acOpen);
  useEffect(() => { acOpenRef.current = acOpen; }, [acOpen]);
  const acIdxRef = useRef(acIdx);
  useEffect(() => { acIdxRef.current = acIdx; }, [acIdx]);

  const matches = useMemo(() => {
    if (!value.startsWith("/")) return [];
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(value) && c.cmd !== value);
  }, [value]);
  const matchesRef = useRef(matches);
  useEffect(() => { matchesRef.current = matches; }, [matches]);

  const doSubmit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (disabledRef.current) return;
    submitRef.current(trimmed);
    setValue("");
    setAcOpen(false);
    setAcIdx(0);
  }, []);

  // SINGLE useInput for the CommandDock — handles Enter, history, autocomplete.
  // This is ONLY mounted when no overlay is open (the app hides CommandDock
  // during overlays), so there is no conflict with overlay handlers.
  useInput(useCallback((input: string, key: KeyInfo) => {
    // Debug instrumentation — write to Activity, NOT console.log
    if (KEY_DEBUG && (isEnter(key, input) || isEscape(key, input) || key.ctrl)) {
      const info = `KEY input=${JSON.stringify(input)} return=${key.return} enter=${(key as { enter?: boolean }).enter ?? false} ctrl=${key.ctrl} esc=${key.escape} overlay=none target=command-dock`;
      onDebugKey?.(info);
    }

    if (disabledRef.current) return;

    // ── Enter — the CommandDock owns this ──
    if (isEnter(key, input)) {
      // If autocomplete is open, accept the selected item
      if (acOpenRef.current && matchesRef.current.length > 0) {
        const selected = matchesRef.current[acIdxRef.current];
        if (selected) {
          setValue(selected.cmd + " ");
          setAcOpen(false);
          setAcIdx(0);
          return;
        }
      }
      // Otherwise, submit the current value
      doSubmit(valueRef.current);
      return;
    }

    // ── Escape — close autocomplete or clear value ──
    if (isEscape(key, input)) {
      if (acOpenRef.current) {
        setAcOpen(false);
        setAcIdx(0);
      } else {
        setValue("");
      }
      return;
    }

    // ── Tab — accept autocomplete (same as Enter when AC is open) ──
    if (isTab(key) && acOpenRef.current && matchesRef.current.length > 0) {
      const selected = matchesRef.current[acIdxRef.current];
      if (selected) {
        setValue(selected.cmd + " ");
        setAcOpen(false);
        setAcIdx(0);
        return;
      }
    }

    // ── Arrow up/down — history or autocomplete navigation ──
    if (isUpArrow(key)) {
      if (acOpenRef.current && matchesRef.current.length > 0) {
        setAcIdx((prev) => Math.max(0, prev - 1));
      } else {
        const prev = onNavigateHistory("up");
        if (prev !== null) setValue(prev);
      }
      return;
    }
    if (isDownArrow(key)) {
      if (acOpenRef.current && matchesRef.current.length > 0) {
        setAcIdx((prev) => Math.min(matchesRef.current.length - 1, prev + 1));
      } else {
        const next = onNavigateHistory("down");
        if (next !== null) setValue(next);
      }
      return;
    }

    // ── Open autocomplete on "/" ──
    if (input === "/" && valueRef.current === "") {
      setAcOpen(true);
      return;
    }

    // Typing more characters updates the filter
    if (acOpenRef.current && input.length === 1 && !key.ctrl && !key.meta) {
      setAcIdx(0);
    }
  }, [doSubmit, onNavigateHistory, onDebugKey]));

  // Close autocomplete if value no longer starts with /
  useEffect(() => {
    if (!value.startsWith("/")) {
      if (acOpen) setAcOpen(false);
    }
  }, [value, acOpen]);

  const showAc = acOpen && matches.length > 0;

  return (
    <Box flexDirection="column" marginTop={0}>
      {/* Slash autocomplete menu */}
      {showAc && (
        <Box flexDirection="column" marginBottom={0}>
          {matches.slice(0, 8).map((m, idx) => {
            const isSelected = idx === acIdx;
            return (
              <Box key={m.cmd}>
                <Text color={isSelected ? COLORS.brand : undefined}>
                  {isSelected ? "> " : "  "}
                </Text>
                <Text color={isSelected ? COLORS.brand : COLORS.working} bold={isSelected}>
                  {m.cmd.padEnd(12)}
                </Text>
                <Text dimColor> {m.description}</Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Box>
        <Text color={COLORS.brand} bold>{prompt} </Text>
        {disabled ? (
          <Text dimColor>processing...</Text>
        ) : (
          <TextInput
            value={value}
            onChange={setValue}
            placeholder="Ask LiTT or type / for commands"
          />
        )}
      </Box>
      {history.length > 0 && !disabled && !showAc && (
        <Text dimColor> </Text>
      )}
      {history.length === 0 && !disabled && !showAc && (
        <Text dimColor> / commands · ↑↓ history · Esc clear</Text>
      )}
    </Box>
  );
}
