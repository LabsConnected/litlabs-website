/**
 * Composer — the single input line of the LiTT shell — the product's
 * center of gravity.
 *
 * ```
 *   │ › What's slowing down my PC?▌          ← focused (cursor blinks)
 *   │ › Ask LiTT anything...                 ← idle (placeholder)
 *   │ › LiTT is working…          Esc to stop ← busy (no cursor)
 * ```
 *
 * The thin brand left accent + `›` prompt + software cursor are the
 * ONLY focus signals — no loud box, no glow. The native terminal cursor
 * stays hidden (Ink hides it); this component renders its own
 * blinking `▌` at the actual caret position.
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
 * overlays can read and extend it, then the composer restores it on
 * close (the store holds it — the composer never loses focus content).
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { normalizeKey, type KeyInfo } from "../input-keys.js";
import {
  applyKeyEvent, createComposerState, graphemeToCodeUnit,
  type ComposerState,
} from "../composer-editor.js";
import { COLORS } from "../colors.js";
import { useCursorBlink } from "../use-cursor-blink.js";
import { deriveFocusState } from "../focus-state.js";

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
  /** True when the transcript is scrolled into history (not live). */
  scrolled?: boolean;
  /** Focus epoch from the store — caret restarts ONCE per transition. */
  focusEpoch?: number;
  /** Typing while scrolled returns the transcript to live + restores focus. */
  onReturnToLive?: () => void;
}

export function Composer({
  value, onChange, onSubmit, onNavigateHistory,
  onOpenPalette, onOpenContext, disabled, busy, scrolled, focusEpoch, onReturnToLive,
}: ComposerProps): React.ReactElement {
  const [caret, setCaret] = React.useState(() => {
    // Initialize caret in grapheme coordinates
    const graphemes = value.split(""); // fallback — fine for initial
    return graphemes.length;
  });

  // ─── Focus ownership — ONE authority (focus-state.ts) ────────────
  // The composer renders its caret and runs its blink timer ONLY from
  // this derivation. Stream chunks, timer ticks, and status updates
  // never re-assert focus; only genuine transitions (overlay close,
  // run settle, return-to-live) restart the caret via the epoch.
  const focus = deriveFocusState({
    overlayActive: false, // the composer only renders when no overlay is open
    busy: !!(disabled || busy),
    approvalActive: false, // covered by disabled (APPROVAL disables the composer)
    scrolled: !!scrolled,
  });
  const cursor = useCursorBlink(550, 700, focus.blinkEnabled, focusEpoch ?? null);

  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);
  const caretRef = useRef(caret);
  useEffect(() => { caretRef.current = caret; }, [caret]);
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  const scrolledRef = useRef(scrolled);
  useEffect(() => { scrolledRef.current = scrolled; }, [scrolled]);

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
  const onReturnToLiveRef = useRef(onReturnToLive);
  useEffect(() => { onReturnToLiveRef.current = onReturnToLive; }, [onReturnToLive]);
  const pokeRef = useRef(cursor.poke);
  useEffect(() => { pokeRef.current = cursor.poke; }, [cursor.poke]);

  useInput(useCallback((input: string, key: KeyInfo) => {
    if (disabledRef.current) return;

    const evt = normalizeKey(input, key);

    // Handle non-editing keys first (they have side effects).
    switch (evt.kind) {
      case "SUBMIT": {
        const text = valueRef.current.trim();
        if (!text) return;
        onSubmitRef.current(text);
        return;
      }
      case "ESCAPE": {
        if (valueRef.current) {
          onChangeRef.current("");
          setCaret(0);
          valueRef.current = "";
          caretRef.current = 0;
          pokeRef.current();
        }
        return;
      }
      case "UP": {
        const prev = onNavigateHistoryRef.current("up");
        if (prev !== null) {
          onChangeRef.current(prev);
          setCaret(prev.length);
          valueRef.current = prev;
          caretRef.current = prev.length;
          pokeRef.current();
        }
        return;
      }
      case "DOWN": {
        const prev = onNavigateHistoryRef.current("down");
        if (prev !== null) {
          onChangeRef.current(prev);
          setCaret(prev.length);
          valueRef.current = prev;
          caretRef.current = prev.length;
          pokeRef.current();
        }
        return;
      }
      case "INSERT_TEXT": {
        // Typing while scrolled into history is an explicit "I'm back in
        // the composer" signal — return to live.
        if (scrolledRef.current) onReturnToLiveRef.current?.();

        // Apply through the grapheme-safe editor.
        const state: ComposerState = { text: valueRef.current, caret: caretRef.current };
        const next = applyKeyEvent(state, evt);
        onChangeRef.current(next.text);
        setCaret(next.caret);
        valueRef.current = next.text;
        caretRef.current = next.caret;
        pokeRef.current();

        // / and @ triggers fire when the draft STARTS with them.
        if (caretRef.current === 0 || next.text.startsWith("/") || next.text.startsWith("@")) {
          // Check if this was the first character
          if (evt.text === "/" && valueRef.current.length === 0) onOpenPaletteRef.current("");
          else if (evt.text === "@" && valueRef.current.length === 0) onOpenContextRef.current("");
          else if (next.text.startsWith("/") && next.text.length > 1) onOpenPaletteRef.current(next.text.slice(1));
          else if (next.text.startsWith("@") && next.text.length > 1) onOpenContextRef.current(next.text.slice(1));
        }
        return;
      }
      case "CANCEL":
      case "TAB":
      case "SHIFT_TAB":
      case "PAGE_UP":
      case "PAGE_DOWN":
        // These are handled by the app-level handler, not the composer.
        return;
      default: {
        // Editing keys: BACKSPACE, DELETE, DELETE_WORD_LEFT,
        // DELETE_TO_START, DELETE_TO_END, MOVE_LEFT, MOVE_RIGHT,
        // MOVE_HOME, MOVE_END — all go through the grapheme-safe editor.
        const state: ComposerState = { text: valueRef.current, caret: caretRef.current };
        const next = applyKeyEvent(state, evt);
        if (next.text !== state.text || next.caret !== state.caret) {
          onChangeRef.current(next.text);
          setCaret(next.caret);
          valueRef.current = next.text;
          caretRef.current = next.caret;
          pokeRef.current();
        }
        return;
      }
    }
  }, []));

  const placeholder = "Ask LiTT anything...";
  // The software caret exists ONLY when the composer is genuinely the
  // active interaction target (idle + live). Busy, overlay, approval,
  // and scrolled-history states never manufacture a fake caret.
  const cursorVisible = focus.showCaret && cursor.visible;

  const renderInput = () => {
    if (busy || disabled) {
      return <Text dimColor>LiTT is working…</Text>;
    }
    // Convert grapheme caret to code-unit index for rendering
    const codeUnitCaret = graphemeToCodeUnit(value, caret);
    const before = value.slice(0, codeUnitCaret);
    const after = value.slice(codeUnitCaret);
    if (value.length === 0) {
      return (
        <>
          <Text color={COLORS.brand} bold>{cursorVisible ? "▌" : " "}</Text>
          <Text dimColor>{placeholder}</Text>
        </>
      );
    }
    return (
      <Text color={COLORS.text}>
        {before}
        <Text color={COLORS.brand} bold>{cursorVisible ? "▌" : " "}</Text>
        {after}
      </Text>
    );
  };

  return (
    <Box
      flexDirection="row"
      marginTop={1}
      borderStyle="single"
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderLeft
      borderLeftColor={COLORS.brand}
      paddingLeft={1}
    >
      <Box flexGrow={1}>
        <Text bold color={COLORS.brand}>› </Text>
        {renderInput()}
      </Box>
      {(busy || disabled) && (
        <Text dimColor>Esc to stop</Text>
      )}
    </Box>
  );
}
