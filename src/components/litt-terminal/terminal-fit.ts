/**
 * TerminalFitController — owns the xterm fit ↔ PTY resize lifecycle.
 *
 * Responsibilities:
 *  - Refit the terminal whenever its mount container changes size
 *    (ResizeObserver, tab visibility, webfont load, window resize).
 *  - Coalesce bursts of resize notifications into one fit per frame, so
 *    dock drag-resize / CSS transitions cannot cause flicker or a
 *    fit → resize → fit feedback loop.
 *  - Propagate cols/rows to the PTY only when they actually changed —
 *    duplicate resize events are never emitted.
 *  - Never fit while the container is hidden (display:none reports 0×0;
 *    fitting then would collapse the terminal to the 2×1 minimum and
 *    emit bogus dims).
 */

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface TerminalFitControllerOptions {
  /** The element xterm was opened into — the actual measured container. */
  getContainer: () => HTMLElement | null;
  /** Runs FitAddon.fit() — may throw while the renderer is not ready. */
  fit: () => void;
  /** Current xterm dimensions, read after a successful fit. */
  getDimensions: () => TerminalDimensions;
  /** Push the new size to the PTY (socket emit — safe no-op offline). */
  emitResize: (cols: number, rows: number) => void;
  /** Injectable frame scheduler for tests. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

export class TerminalFitController {
  private lastEmitted: TerminalDimensions | null = null;
  private frameId: number | null = null;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrame: (id: number) => void;

  constructor(private readonly opts: TerminalFitControllerOptions) {
    this.requestFrame =
      opts.requestFrame ??
      ((cb) => requestAnimationFrame(() => cb()));
    this.cancelFrame =
      opts.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  }

  /**
   * Fit immediately and propagate the resulting dims when they changed.
   * Returns early (without fitting or emitting) while the container has
   * no measurable size — i.e. the terminal tab is display:none.
   */
  fitNow = (): void => {
    const el = this.opts.getContainer();
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    try {
      this.opts.fit();
    } catch {
      return; // renderer not ready — a later notification retries
    }
    const dims = this.opts.getDimensions();
    if (
      this.lastEmitted &&
      this.lastEmitted.cols === dims.cols &&
      this.lastEmitted.rows === dims.rows
    ) {
      return;
    }
    this.lastEmitted = dims;
    this.opts.emitResize(dims.cols, dims.rows);
  };

  /**
   * Schedule a fit on the next animation frame. Repeated calls inside the
   * same frame collapse into a single refit — this is what keeps
   * ResizeObserver bursts and animated size changes smooth instead of
   * jittery.
   */
  requestFit = (): void => {
    if (this.frameId !== null) return;
    this.frameId = this.requestFrame(() => {
      this.frameId = null;
      this.fitNow();
    });
  };

  /**
   * Forget the last emitted dims so the next successful fit always emits.
   * Call when the PTY session (re)connects: the server spawns each PTY
   * with default dims, so the client-side "already emitted" record is
   * stale the moment a new session starts.
   */
  invalidateEmitted = (): void => {
    this.lastEmitted = null;
  };

  dispose = (): void => {
    if (this.frameId !== null) {
      this.cancelFrame(this.frameId);
      this.frameId = null;
    }
  };
}
