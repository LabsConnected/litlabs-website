/**
 * FocusState — the ONE small authority for composer focus ownership.
 *
 * The shell must never trap the user in the input. Focus restoration is
 * EVENT-BASED, never render-based: the composer only owns the software
 * caret and keyboard input when it is genuinely the active interaction
 * target. Streaming deltas, the busy timer, semantic events, and status
 * bar updates must NEVER re-assert focus.
 *
 * Two pieces:
 *
 * 1. `deriveFocusState()` — a pure projection of the UI state onto the
 *    composer's focus/caret signals. The composer renders its caret and
 *    runs its blink timer ONLY from this derivation.
 *
 * 2. `FocusEpochTracker` — the event counter for focus restoration.
 *    Exactly-once per transition:
 *      - an overlay closes        (setOverlay "x" → "none")
 *      - a run settles            (busy → idle: complete/failed/cancelled)
 *      - an explicit restore call (typing after returning from history)
 *    The epoch value is bumped by the STORE at those transitions; the
 *    composer restarts its steady caret on epoch change. Repeated
 *    renders, stream chunks, timer ticks, or no-op state updates never
 *    touch the epoch — no focus loop.
 *
 * Pure and framework-agnostic: unit-testable in a node environment
 * without a React renderer.
 */

export interface FocusInputs {
  /** An overlay (palette, picker, /diff, /ship…) owns the keyboard. */
  overlayActive: boolean;
  /** A run is in progress (chat/mission) — composer is disabled. */
  busy: boolean;
  /** An approval prompt is on screen and owns the keys. */
  approvalActive: boolean;
  /** The transcript is scrolled into history (not live). */
  scrolled: boolean;
}

export interface FocusDerivation {
  /** The composer is the keyboard target and may accept input. */
  composerEligible: boolean;
  /** Paint the software caret ▌. */
  showCaret: boolean;
  /** Run the blink timer (false = no self-initiated repaints). */
  blinkEnabled: boolean;
}

export function deriveFocusState(inputs: FocusInputs): FocusDerivation {
  // Overlay / approval / busy: the composer is NOT the interaction
  // target — no caret, no blink, no input ownership. (Esc/PgUp/Home/End
  // still work through the app shortcut handler while busy.)
  if (inputs.overlayActive || inputs.approvalActive || inputs.busy) {
    return { composerEligible: false, showCaret: false, blinkEnabled: false };
  }

  // Idle composer, but scrolled into history: typing may still work
  // (and returns to live), yet the composer is not the active target —
  // never manufacture a fake caret or blink while browsing history.
  if (inputs.scrolled) {
    return { composerEligible: true, showCaret: false, blinkEnabled: false };
  }

  // Idle + live: the composer owns the caret. Blink is ON — this is the
  // only self-initiated repaint the composer ever does, and it is the
  // desired behavior (a blinking ▌ is the focus signal).
  return { composerEligible: true, showCaret: true, blinkEnabled: true };
}

/**
 * FocusEpochTracker — exactly-once, event-based focus restoration.
 *
 * The epoch increments ONLY on real restoration transitions:
 *   - overlay close:      "command-palette" → "none"   (+1)
 *   - run settle:         busy true → false            (+1)
 *   - explicit bump:      e.g. user types after PgUp   (+1)
 *
 * No-op updates (same overlay, already idle, repeated stopBusy calls,
 * re-renders) never change the epoch — the composer can never enter a
 * focus loop from repeated renders.
 */
export class FocusEpochTracker {
  private _overlay: string;
  private _busy: boolean;
  private _epoch: number;

  constructor(initial: { overlay?: string; busy?: boolean; epoch?: number } = {}) {
    this._overlay = initial.overlay ?? "none";
    this._busy = initial.busy ?? false;
    // Epoch 1 = "focused at launch" (the allowed initial focus moment).
    this._epoch = initial.epoch ?? 1;
  }

  get epoch(): number {
    return this._epoch;
  }

  /** Set the overlay. Returns the current epoch. */
  setOverlay(next: string): number {
    const closed = this._overlay !== "none" && next === "none";
    this._overlay = next;
    if (closed) this._epoch += 1;
    return this._epoch;
  }

  /** Set busy state. Returns the current epoch. */
  setBusy(busy: boolean): number {
    const settled = this._busy && !busy;
    this._busy = busy;
    if (settled) this._epoch += 1;
    return this._epoch;
  }

  /** Explicit restore (e.g. typing returns from history to live). */
  bump(): number {
    this._epoch += 1;
    return this._epoch;
  }
}
