import { describe, it, expect, vi } from "vitest";
import {
  TerminalFitController,
  type TerminalDimensions,
} from "./terminal-fit";

/**
 * Regression coverage for the terminal resize/viewport pipeline.
 *
 * Bugs this guards against (all observed in the Studio dock terminal):
 *  1. Fitting while the tab is display:none collapses xterm to the 2×1
 *     minimum and emits bogus dims to the PTY.
 *  2. Every resize notification re-emitted terminal:resize even when
 *     cols/rows were unchanged — a feedback loop that caused jitter.
 *  3. After a (re)connect the PTY kept server-default dims (120×32)
 *     because the client thought the size was "already emitted".
 *  4. Bursts of size changes (dock drag, CSS transitions) triggered one
 *     fit per notification instead of one per frame → visible flicker.
 */

function makeContainer(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

function createManualFrameScheduler() {
  const queue = new Map<number, () => void>();
  let nextId = 1;
  return {
    requestFrame: (cb: () => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelFrame: (id: number) => {
      queue.delete(id);
    },
    flush: () => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb();
    },
    get pending() {
      return queue.size;
    },
  };
}

function setup(dims: TerminalDimensions, container: HTMLElement | null) {
  const scheduler = createManualFrameScheduler();
  const fit = vi.fn();
  const emitResize = vi.fn();
  const controller = new TerminalFitController({
    getContainer: () => container,
    fit,
    getDimensions: () => dims,
    emitResize,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
  });
  return { controller, fit, emitResize, scheduler };
}

describe("TerminalFitController", () => {
  it("fits and emits dims on the first successful fit", () => {
    const { controller, fit, emitResize } = setup(
      { cols: 120, rows: 30 },
      makeContainer(800, 400),
    );
    controller.fitNow();
    expect(fit).toHaveBeenCalledTimes(1);
    expect(emitResize).toHaveBeenCalledTimes(1);
    expect(emitResize).toHaveBeenCalledWith(120, 30);
  });

  it("does not emit when dims are unchanged — no resize feedback loop", () => {
    const { controller, fit, emitResize } = setup(
      { cols: 120, rows: 30 },
      makeContainer(800, 400),
    );
    controller.fitNow();
    controller.fitNow();
    controller.fitNow();
    expect(fit).toHaveBeenCalledTimes(3);
    expect(emitResize).toHaveBeenCalledTimes(1);
  });

  it("never fits or emits while the container is hidden (0×0)", () => {
    const { controller, fit, emitResize } = setup(
      { cols: 2, rows: 1 },
      makeContainer(0, 0),
    );
    controller.fitNow();
    controller.requestFit();
    expect(fit).not.toHaveBeenCalled();
    expect(emitResize).not.toHaveBeenCalled();
  });

  it("never fits or emits when the container ref is unmounted", () => {
    const { controller, fit, emitResize } = setup(
      { cols: 80, rows: 24 },
      null,
    );
    controller.fitNow();
    expect(fit).not.toHaveBeenCalled();
    expect(emitResize).not.toHaveBeenCalled();
  });

  it("coalesces bursts of resize notifications into one fit per frame", () => {
    const { controller, fit, emitResize, scheduler } = setup(
      { cols: 120, rows: 30 },
      makeContainer(800, 400),
    );
    // A dock drag / RO burst produces many notifications inside one frame.
    for (let i = 0; i < 10; i++) controller.requestFit();
    expect(scheduler.pending).toBe(1);
    scheduler.flush();
    expect(fit).toHaveBeenCalledTimes(1);
    expect(emitResize).toHaveBeenCalledTimes(1);
  });

  it("emits again after invalidateEmitted (PTY respawned with defaults)", () => {
    const { controller, emitResize, scheduler } = setup(
      { cols: 120, rows: 30 },
      makeContainer(800, 400),
    );
    controller.fitNow();
    expect(emitResize).toHaveBeenCalledTimes(1);

    // Server spawned a fresh PTY at 120×32 — our dims must be re-sent
    // even though the rendered size did not change.
    controller.invalidateEmitted();
    controller.requestFit();
    scheduler.flush();
    expect(emitResize).toHaveBeenCalledTimes(2);
    expect(emitResize).toHaveBeenLastCalledWith(120, 30);
  });

  it("stays correct through repeated smaller → larger → smaller resizes", () => {
    let dims: TerminalDimensions = { cols: 120, rows: 30 };
    const container = makeContainer(800, 400);
    const scheduler = createManualFrameScheduler();
    const fit = vi.fn();
    const emitResize = vi.fn();
    const controller = new TerminalFitController({
      getContainer: () => container,
      fit,
      getDimensions: () => dims,
      emitResize,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
    });

    controller.fitNow();
    dims = { cols: 80, rows: 20 };
    controller.requestFit();
    scheduler.flush();
    dims = { cols: 140, rows: 40 };
    controller.requestFit();
    scheduler.flush();
    dims = { cols: 80, rows: 20 };
    controller.requestFit();
    scheduler.flush();
    dims = { cols: 80, rows: 20 };
    controller.requestFit();
    scheduler.flush();

    expect(emitResize.mock.calls).toEqual([
      [120, 30],
      [80, 20],
      [140, 40],
      [80, 20],
    ]);
  });

  it("swallows a not-ready renderer without emitting", () => {
    const scheduler = createManualFrameScheduler();
    const emitResize = vi.fn();
    const controller = new TerminalFitController({
      getContainer: () => makeContainer(800, 400),
      fit: () => {
        throw new Error("renderer not ready");
      },
      getDimensions: () => ({ cols: 80, rows: 24 }),
      emitResize,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
    });
    expect(() => controller.fitNow()).not.toThrow();
    expect(emitResize).not.toHaveBeenCalled();
  });

  it("cancels a pending frame on dispose — no fit after unmount", () => {
    const { controller, fit, emitResize, scheduler } = setup(
      { cols: 120, rows: 30 },
      makeContainer(800, 400),
    );
    controller.requestFit();
    expect(scheduler.pending).toBe(1);
    controller.dispose();
    expect(scheduler.pending).toBe(0);
    scheduler.flush();
    expect(fit).not.toHaveBeenCalled();
    expect(emitResize).not.toHaveBeenCalled();
  });
});
