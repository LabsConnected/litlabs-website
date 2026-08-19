/**
 * Composer — the single input line of the LiTT shell.
 *
 * `› Ask LiTT anything...`
 *
 * Owns ALL printable key handling (no ink-text-input) so the shell has
 * one keyboard truth:
 *   - typing `/` at the start   → opens the command palette
 *   - typing `@` at the start   → opens the context picker
 *   - Enter                     → submit
 *   - Esc                       → clear the draft
 *   - Tab                       → falls through to the app handler (Plan/Act)
 *   - ↑↓                        → command history (when idle)
 *
 * The draft lives in the CockpitStore (composerValue) so the / and @
 * overlays can read and extend it (e.g. picking a file appends the
 * token), then the composer restores it on close.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import {
  isEnter, isEscape, isUpArrow, isDownArrow, isBackspace,
  type KeyInfo,
} from "../keyboard-utils.js";
import { COLORS } from "../colors.js";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onNavigateHistory: (direction: "up" | "down") => string | null;
  /** Opens the command palette, seeded with the partial query. */
  onOpenPalette: (query: string) => void;
  /** Opens the context picker, seeded with the partial query. */
  onOpenContext: (query: string) => void;
  disabled: boolean;
  /** True while a mission/chat is processing — composer shows a live indicator. */
  busy?: boolean;
}

export function Composer({
  value, onChange, onSubmit, onNavigateHistory,
  onOpenPalette, onOpenContext, disabled, busy,
}: ComposerProps): React.ReactElement {
  const [caret, setCaret] = React.useState(value.length);

  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);
  const caretRef = useRef(caret);
  useEffect(() => { caretRef.current = caret; }, [caret]);
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
  const onNavigateHistoryRef = useRef(onNavigateHistory);
  useEffect(() => { onNavigateHistoryRef.current = onNavigateHistory; }, [onNavigateHistory]);
  const onOpenPaletteRef = useRef(onOpenPalette);
  useEffect(() => { onOpenPaletteRef.current = onOpenPalette; }, [onOpenPalette]);
  const onOpenContextRef = useRef(onOpenContext);
  useEffect(() => { onOpenContextRef.current = onOpenContext; }, [onOpenContext]);

  useInput(useCallback((input: string, key: KeyInfo) => {
    if (disabledRef.current) return;

    const current = valueRef.current;
    const pos = caretRef.current;

    // Enter — submit (always full value; slash/@ commands handled by the controller).
    if (isEnter(key, input)) {
      const text = current.trim();
      if (!text) return;
      onSubmitRef.current(text);
      return;
    }

    // Esc — clear draft (autocomplete menus are gone; overlays own their own Esc).
    if (isEscape(key, input)) {
      if (current) {
        onChangeRef.current("");
        setCaret(0);
      }
      return;
    }

    // Tab — intentionally NOT handled here: the app shortcut handler
    // toggles Plan/Act. (Ink delivers Tab as key.tab with empty input,
    // so the insert path below is never reached for Tab.)

    // History navigation — only when the draft is empty (↑↓).
    if (isUpArrow(key) || isDownArrow(key)) {
      const prev = onNavigateHistoryRef.current(isUpArrow(key) ? "up" : "down");
      if (prev !== null) {
        onChangeRef.current(prev);
        setCaret(prev.length);
      }
      return;
    }

    // Backspace / Delete.
    if (isBackspace(key)) {
      if (pos === 0) return;
      const next = current.slice(0, pos - 1) + current.slice(pos);
      onChangeRef.current(next);
      setCaret(Math.max(0, pos - 1));
      return;
    }

    // Left / Right caret movement.
    if (key.leftArrow && pos > 0) { setCaret(pos - 1); return; }
    if (key.rightArrow && pos < current.length) { setCaret(pos + 1); return; }

    // Printable input — insert at caret. Paste arrives as a multi-char string.
    if (input && !key.ctrl && !key.meta && key.tab === false) {
      const next = current.slice(0, pos) + input + current.slice(pos);
      onChangeRef.current(next);
      setCaret(pos + input.length);

      // / and @ triggers fire when the draft STARTS with them (typed at
      // the very first position). The overlay takes the partial query so
      // fast typing isn't lost — whatever made it into the draft becomes
      // the palette's initial filter.
      if (pos === 0 && input === "/") onOpenPaletteRef.current("");
      else if (pos === 0 && input === "@") onOpenContextRef.current("");
      else if (pos === 0 && next.startsWith("/") && next.length > 1) onOpenPaletteRef.current(next.slice(1));
      else if (pos === 0 && next.startsWith("@") && next.length > 1) onOpenContextRef.current(next.slice(1));
      return;
    }
  }, []));

  const placeholder = busy ? "LiTT is working…" : "Ask LiTT anything...";

  return (
    <Box marginTop={1}>
      <Text color={COLORS.brand} bold>› </Text>
      {disabled ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        <Box flexDirection="row">
          <Text color={COLORS.text}>
            {value.slice(0, caret)}
            <Text color={COLORS.brand} bold>{value[caret] ?? " "}</Text>
            {value.slice(caret + 1)}
          </Text>
          {value.length === 0 && <Text dimColor>{placeholder}</Text>}
        </Box>
      )}
    </Box>
  );
}
