import { describe, expect, it } from "vitest";
import { runVisualJudge } from "./visual-judge";

/**
 * ACC-06a item 2 — the preview-inspection session must never hang a
 * run. runVisualJudge awaited the screenshot capture with NO
 * timeout: when the headless browser session could not start and
 * the underlying call stalled (Acceptance evidence 2026-11-24: a
 * run sat "in progress" because its preview-inspection session
 * could not start), the quality inspection never returned, the
 * agent loop never settled, and the run stayed in progress forever.
 * A capture that cannot start must settle the inspection honestly
 * as unavailable — with the timeout named as the reason.
 */
const context = {
  userRequest: "Build a bakery site",
  previewUrl: "https://preview.example.test/",
};

describe("runVisualJudge — capture cannot hang the run (ACC-06a item 2)", () => {
  it("settles unavailable with a timeout reason when the inspection session never starts", async () => {
    // A capture whose session start stalls forever.
    const hangingCapture = () => new Promise<never>(() => {});
    const outcome = await Promise.race([
      runVisualJudge({
        screenshot: null,
        context,
        capture: hangingCapture,
        captureTimeoutMs: 50,
      }),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2_000)),
    ]);
    expect(outcome).not.toBe("hung");
    const settled = outcome as Exclude<typeof outcome, "hung">;
    expect(settled.status).toBe("unavailable");
    expect(settled.reason).toMatch(/timed out/i);
  });

  it("settles unavailable when the capture throws (session start failure)", async () => {
    const outcome = await runVisualJudge({
      screenshot: null,
      context,
      capture: async () => {
        throw new Error("browser session failed to start");
      },
      captureTimeoutMs: 50,
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.reason).toBeTruthy();
  });

  it("settles unavailable when the capture returns nothing", async () => {
    const outcome = await runVisualJudge({
      screenshot: null,
      context,
      capture: async () => null,
      captureTimeoutMs: 50,
    });
    expect(outcome.status).toBe("unavailable");
  });
});
