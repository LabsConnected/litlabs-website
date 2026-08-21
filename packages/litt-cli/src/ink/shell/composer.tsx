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
import {
  isEnter, isEscape, isUpArrow, isDownArrow, isBackspace,
  type KeyInfo,
} from "../keyboard-utils.js";
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
  const [caret, setCaret] = React.useState(value.length);

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
        // Synchronously update refs — when multiple useInput calls fire
        // in the same macrotask (same stdin read), useEffect hasn't run
        // yet, so valueRef/caretRef would be stale for the next call.
        valueRef.current = "";
        caretRef.current = 0;
        pokeRef.current();
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
        // Synchronously update refs (see Esc comment above).
        valueRef.current = prev;
        caretRef.current = prev.length;
        pokeRef.current();
      }
      return;
    }

    // Backspace / Delete.
    if (isBackspace(key, input)) {
      if (pos === 0) return;
      const next = current.slice(0, pos - 1) + current.slice(pos);
      const nextCaret = Math.max(0, pos - 1);
      onChangeRef.current(next);
      setCaret(nextCaret);
      // Synchronously update refs — critical for fast typing where
      // multiple useInput calls (type + backspace) arrive in the same
      // stdin read. Without this, the backspace handler reads stale
      // valueRef/caretRef from before the typing handler ran, sees
      // pos=0, and becomes a no-op.
      valueRef.current = next;
      caretRef.current = nextCaret;
      pokeRef.current();
      return;
    }

    // Left / Right caret movement.
    if (key.leftArrow && pos > 0) {
      const nextCaret = pos - 1;
      setCaret(nextCaret);
      caretRef.current = nextCaret;
      pokeRef.current();
      return;
    }
    if (key.rightArrow && pos < current.length) {
      const nextCaret = pos + 1;
      setCaret(nextCaret);
      caretRef.current = nextCaret;
      pokeRef.current();
      return;
    }

    // Printable input — insert at caret. Paste arrives as a multi-char string.
    if (input && !key.ctrl && !key.meta && key.tab === false) {
      // Typing while scrolled into history is an explicit "I'm back in
      // the composer" signal — return to live (focus restored once by
      // the store's bumpFocus). Never yank the view while merely
      // streaming or on timer ticks.
      if (scrolledRef.current) onReturnToLiveRef.current?.();

      const next = current.slice(0, pos) + input + current.slice(pos);
      const nextCaret = pos + input.length;
      onChangeRef.current(next);
      setCaret(nextCaret);
      // Synchronously update refs (see Backspace comment above).
      valueRef.current = next;
      caretRef.current = nextCaret;
      pokeRef.current();

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

  const placeholder = "Ask LiTT anything...";
  // The software caret exists ONLY when the composer is genuinely the
  // active interaction target (idle + live). Busy, overlay, approval,
  // and scrolled-history states never manufacture a fake caret.
  const cursorVisible = focus.showCaret && cursor.visible;

  const renderInput = () => {
    if (busy || disabled) {
      return <Text dimColor>LiTT is working…</Text>;
    }
    const before = value.slice(0, caret);
    const after = value.slice(caret);
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
