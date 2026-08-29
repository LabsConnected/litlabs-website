/**
 * LiTTMark — the shard sigil with state-driven presentation.
 *
 * The LiTT identity mark is a geometric shard (◬) that changes form
 * and color based on what LiTT is doing RIGHT NOW. It is NOT a face,
 * NOT a mascot, NOT generic decoration — it is a compact signal.
 *
 * State system:
 *   idle      → ◳ hollow shard (brand purple, static)
 *   thinking  → ◬ half-filled shard (brandBright, subtle pulse)
 *   executing → ◭ active segment (working purple, animated)
 *   success   → ◬ filled shard (success green, settles)
 *   error     → ◬ filled shard (error red, sharp)
 *   local     → ◬ filled shard (success green — stable local)
 *   remote    → ◬ filled shard (remote blue — signal/cloud)
 *
 * The mark is ALWAYS paired with the "LiTT" wordmark in the header.
 * On narrow terminals the mark stays (it's 1 character) but the
 * wordmark may truncate.
 *
 * Animation is SUBTLE: a 1.2s pulse cycle for thinking/executing,
 * steady for idle/success/error. Respects reduced-motion by
 * rendering the steady glyph only.
 */

import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { COLORS } from "./colors.js";

// ─── Mark states ───────────────────────────────────────────────────

export type MarkState =
  | "idle"
  | "thinking"
  | "executing"
  | "success"
  | "error"
  | "local"
  | "remote";

// ─── Glyphs per state ──────────────────────────────────────────────
// The shard progresses: hollow → half → active → filled.
// This gives a visual sense of "charging up" as LiTT starts working.

const STATIC_GLYPHS: Record<MarkState, string> = {
  idle: "◳",        // hollow shard — waiting
  thinking: "◬",    // half-filled — processing
  executing: "◬",   // filled (animated variant uses ◭)
  success: "◬",     // filled, green
  error: "◬",       // filled, red
  local: "◬",       // filled, green
  remote: "◬",      // filled, blue
};

const ANIMATED_GLYPHS: Record<MarkState, string[]> = {
  idle: ["◳"],                              // static
  thinking: ["◳", "◬"],                     // hollow → half
  executing: ["◬", "◭", "◬"],               // pulse cycle
  success: ["◬"],                            // static
  error: ["◬"],                              // static
  local: ["◬"],                              // static
  remote: ["◬"],                             // static
};

const STATE_COLORS: Record<MarkState, string> = {
  idle: COLORS.brand,
  thinking: COLORS.brandBright,
  executing: COLORS.working,
  success: COLORS.success,
  error: COLORS.error,
  local: COLORS.success,
  remote: COLORS.remote,
};

// ─── Animation timing ──────────────────────────────────────────────

const PULSE_MS = 1200; // 1.2s cycle — subtle, not distracting

// ─── LiTTMark component ────────────────────────────────────────────

export interface LiTTMarkProps {
  /** The current operational state of LiTT. */
  state?: MarkState;
  /** Whether to show the "LiTT" wordmark after the glyph. */
  showWordmark?: boolean;
  /** Bold the wordmark (default true in header). */
  boldWordmark?: boolean;
  /** Override reduced-motion (force animation off for tests). */
  reducedMotion?: boolean;
  /** Size — currently only affects wordmark presence. */
  size?: "compact" | "normal";
}

export function LiTTMark({
  state = "idle",
  showWordmark = true,
  boldWordmark = true,
  reducedMotion = false,
  size = "normal",
}: LiTTMarkProps): React.ReactElement {
  const color = STATE_COLORS[state];
  const animated = !reducedMotion && (state === "thinking" || state === "executing");

  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!animated) return;
    const frames = ANIMATED_GLYPHS[state];
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, PULSE_MS / frames.length);
    return () => clearInterval(timer);
  }, [animated, state]);

  const glyph = animated
    ? ANIMATED_GLYPHS[state][frame % ANIMATED_GLYPHS[state].length]
    : STATIC_GLYPHS[state];

  if (!showWordmark || size === "compact") {
    return <Text color={color} bold>{glyph}</Text>;
  }

  return (
    <Text>
      <Text color={color} bold>{glyph}</Text>
      <Text> </Text>
      <Text color={COLORS.brand} bold={boldWordmark}>LiTT</Text>
    </Text>
  );
}

// ─── Pure helpers for tests ────────────────────────────────────────

/** Returns the static glyph for a state (no animation). */
export function markGlyph(state: MarkState): string {
  return STATIC_GLYPHS[state];
}

/** Returns the color for a state. */
export function markColor(state: MarkState): string {
  return STATE_COLORS[state];
}

/** Returns true if a state has animation. */
export function isAnimated(state: MarkState): boolean {
  return state === "thinking" || state === "executing";
}

/** Maps a runtime holo state to a mark state. */
export function holoToMarkState(holo: string): MarkState {
  switch (holo) {
    case "IDLE":
    case "READY":
      return "idle";
    case "UNDERSTANDING":
    case "THINKING":
    case "PLANNING":
      return "thinking";
    case "READING":
    case "EDITING":
    case "RUNNING":
    case "TESTING":
    case "VERIFYING":
      return "executing";
    case "COMPLETE":
    case "SUCCESS":
      return "success";
    case "FAILED":
    case "ERROR":
      return "error";
    case "APPROVAL":
      return "idle"; // approval is a pause, not work
    default:
      return "idle";
  }
}

/** Maps an execution target to a mark state accent. */
export function targetToMarkState(target: "local" | "remote"): MarkState {
  return target === "remote" ? "remote" : "local";
}
