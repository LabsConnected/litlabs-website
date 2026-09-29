import { describe, expect, it } from "vitest";
import { canonicalSurfaceToPersist, resolveStageSurface } from "./stage-surfaces";

/**
 * Phase 3 regression — single-writer surface persistence.
 *
 * The old code had two automatic writers of `lastOpenedSurface` with
 * guards in different vocabularies (encoded "studio/work" vs shell rail
 * id "code"): each PATCH re-triggered the other effect, producing an
 * infinite PATCH oscillation. These tests pin the single canonical
 * decision so the loop can never come back.
 */
describe("canonicalSurfaceToPersist", () => {
  it("Studio → Preview (shell): a legacy stored value resolving to the visible stage needs no write", () => {
    // Task created before the shell wrote rail ids; "studio" resolves to preview.
    expect(resolveStageSurface("studio")).toBe("preview");
    expect(
      canonicalSurfaceToPersist({
        shellActive: true,
        stageSurface: "preview",
        currentSurface: "studio/work",
        storedSurface: "studio",
      }),
    ).toBeNull();
  });

  it("Preview → Activity (shell): persists the new stage exactly once", () => {
    expect(
      canonicalSurfaceToPersist({
        shellActive: true,
        stageSurface: "activity",
        currentSurface: "studio/work",
        storedSurface: "preview",
      }),
    ).toBe("activity");
  });

  it("Activity → Preview (shell): persists the new stage exactly once", () => {
    expect(
      canonicalSurfaceToPersist({
        shellActive: true,
        stageSurface: "preview",
        currentSurface: "studio/work",
        storedSurface: "activity",
      }),
    ).toBe("preview");
  });

  it("refresh / reconnect: an already-in-sync stored value never re-PATCHes", () => {
    expect(
      canonicalSurfaceToPersist({
        shellActive: true,
        stageSurface: "code",
        currentSurface: "studio/work",
        storedSurface: "code",
      }),
    ).toBeNull();
  });

  it("new project / new task on the default stage: no write needed (restore defaults to preview)", () => {
    expect(
      canonicalSurfaceToPersist({
        shellActive: true,
        stageSurface: "preview",
        currentSurface: "studio/work",
        storedSurface: null,
      }),
    ).toBeNull();
  });

  it("new project / new task on a non-default stage: persists the visible stage", () => {
    expect(
      canonicalSurfaceToPersist({
        shellActive: true,
        stageSurface: "code",
        currentSurface: "studio/work",
        storedSurface: null,
      }),
    ).toBe("code");
  });

  it("legacy (non-shell) mode: persists the encoded workspace surface", () => {
    expect(
      canonicalSurfaceToPersist({
        shellActive: false,
        stageSurface: "preview",
        currentSurface: "studio/work:builder",
        storedSurface: "studio/work",
      }),
    ).toBe("studio/work:builder");
  });

  it("legacy (non-shell) mode: in-sync encoded value needs no write", () => {
    expect(
      canonicalSurfaceToPersist({
        shellActive: false,
        stageSurface: "preview",
        currentSurface: "studio/work",
        storedSurface: "studio/work",
      }),
    ).toBeNull();
  });

  it("regression: the old oscillation sequence terminates after one write", () => {
    // Old bug: stage writer stored "code"; the encoded-surface writer then
    // saw "code" !== "studio/work" and PATCHed back, re-triggering the
    // stage writer forever. With the single canonical decision, once the
    // stored value matches the visible stage, no further write is decided.
    const afterStageWrite = canonicalSurfaceToPersist({
      shellActive: true,
      stageSurface: "code",
      currentSurface: "studio/work",
      storedSurface: "code",
    });
    expect(afterStageWrite).toBeNull();

    // And a stale encoded value that resolves to a DIFFERENT stage than
    // the visible one is rewritten exactly once, to the stage id.
    const rewrite = canonicalSurfaceToPersist({
      shellActive: true,
      stageSurface: "code",
      currentSurface: "studio/work",
      storedSurface: "studio/work", // resolves to "preview" ≠ "code"
    });
    expect(rewrite).toBe("code");
    // After that single write lands, the decision is stable again.
    expect(
      canonicalSurfaceToPersist({
        shellActive: true,
        stageSurface: "code",
        currentSurface: "studio/work",
        storedSurface: "code",
      }),
    ).toBeNull();
  });
});
