/**
 * Unit tests for the mobile-viewport publish gate.
 *
 * Coverage contract:
 * - Broken layout (overflow / missing viewport meta / tiny targets / clipped
 *   text) BLOCKS with a specific, non-technical message.
 * - Clean layout PASSES.
 * - Infra-unavailable (capture null / throws) or inconclusive (no metrics)
 *   WARNS — never a silent pass.
 */
import { describe, expect, it, vi } from "vitest";
import {
  analyzeMobileLayout,
  collectMobileLayoutMetrics,
  DEFAULT_MOBILE_GATE_THRESHOLDS,
  MOBILE_GATE_ID,
  MOBILE_GATE_VIEWPORT,
  runMobileLayoutGate,
  type MobileCaptureResult,
  type MobileLayoutMetrics,
} from "./mobile-gate";

function makeMetrics(overrides?: Partial<MobileLayoutMetrics>): MobileLayoutMetrics {
  return {
    viewport: { width: 390, height: 844 },
    hasViewportMeta: true,
    scrollWidth: 390,
    overflowElements: [],
    smallTargets: [],
    clippedElements: [],
    overlaps: [],
    ...overrides,
  };
}

function cleanCapture(metrics?: MobileLayoutMetrics): MobileCaptureResult {
  return { screenshot: "data:image/png;base64,AAA", metrics: metrics ?? makeMetrics() };
}

describe("analyzeMobileLayout", () => {
  it("passes a clean layout with no findings", () => {
    const findings = analyzeMobileLayout(makeMetrics());
    expect(findings).toEqual([]);
  });

  it("blocks on horizontal overflow with a non-technical message", () => {
    const findings = analyzeMobileLayout(
      makeMetrics({
        scrollWidth: 480,
        overflowElements: [
          {
            kind: "menu bar",
            label: "Home About Services",
            position: "near the top of the page",
            overflowPx: 90,
          },
        ],
      }),
    );
    const overflow = findings.find((f) => f.kind === "overflow");
    expect(overflow).toBeDefined();
    expect(overflow!.blocking).toBe(true);
    expect(overflow!.message).toContain("scroll sideways");
    expect(overflow!.message).toContain("menu bar");
    expect(overflow!.message).toContain("near the top of the page");
    // Non-technical: no CSS/DOM jargon.
    expect(overflow!.message).not.toContain("scrollWidth");
    expect(overflow!.message).not.toContain("viewport");
  });

  it("tolerates a few px of overflow", () => {
    const findings = analyzeMobileLayout(
      makeMetrics({ scrollWidth: 395 }),
    );
    expect(findings.find((f) => f.kind === "overflow")).toBeUndefined();
  });

  it("blocks when the viewport meta tag is missing", () => {
    const findings = analyzeMobileLayout(makeMetrics({ hasViewportMeta: false }));
    const meta = findings.find((f) => f.kind === "viewport-meta");
    expect(meta?.blocking).toBe(true);
    expect(meta!.message).toContain("zoomed-out");
  });

  it("blocks on untappable targets and names one", () => {
    const findings = analyzeMobileLayout(
      makeMetrics({
        smallTargets: [
          {
            kind: "button",
            label: "Buy now",
            position: "in the middle of the page",
            widthPx: 18,
            heightPx: 18,
          },
        ],
      }),
    );
    const tap = findings.find((f) => f.kind === "tap-target");
    expect(tap?.blocking).toBe(true);
    expect(tap!.count).toBe(1);
    expect(tap!.message).toContain("too small to tap");
    expect(tap!.message).toContain("Buy now");
  });

  it("advises (does not block) on merely snug targets", () => {
    const findings = analyzeMobileLayout(
      makeMetrics({
        smallTargets: [
          {
            kind: "link",
            label: "Learn more",
            position: "near the bottom of the page",
            widthPx: 30,
            heightPx: 30,
          },
        ],
      }),
    );
    const tap = findings.find((f) => f.kind === "tap-target");
    expect(tap?.blocking).toBe(false);
    expect(tap!.message).toContain("44px");
  });

  it("blocks on clipped text", () => {
    const findings = analyzeMobileLayout(
      makeMetrics({
        clippedElements: [
          {
            kind: "heading",
            label: "Welcome to our amazing store",
            position: "near the top of the page",
            hiddenPx: 40,
          },
        ],
      }),
    );
    const clip = findings.find((f) => f.kind === "clipping");
    expect(clip?.blocking).toBe(true);
    expect(clip!.message).toContain("cut off");
  });

  it("reports overlaps as advisory only", () => {
    const findings = analyzeMobileLayout(
      makeMetrics({
        overlaps: [
          {
            kindA: "heading",
            kindB: "paragraph",
            labelA: "Sale",
            labelB: "Everything must go",
            position: "near the top of the page",
          },
        ],
      }),
    );
    const overlap = findings.find((f) => f.kind === "overlap");
    expect(overlap?.blocking).toBe(false);
    expect(overlap!.message).toContain("not blocking publish");
  });

  it("respects threshold overrides", () => {
    const findings = analyzeMobileLayout(
      makeMetrics({ scrollWidth: 420 }),
      { ...DEFAULT_MOBILE_GATE_THRESHOLDS, maxOverflowPx: 50 },
    );
    expect(findings.find((f) => f.kind === "overflow")).toBeUndefined();
  });
});

describe("runMobileLayoutGate", () => {
  it("blocks a broken layout with a specific message", async () => {
    const result = await runMobileLayoutGate({
      url: "https://example.com/sites/abc/",
      capture: async () =>
        cleanCapture(
          makeMetrics({
            scrollWidth: 500,
            overflowElements: [
              {
                kind: "table",
                label: "Pricing details",
                position: "in the middle of the page",
                overflowPx: 110,
              },
            ],
          }),
        ),
    });
    expect(result.gateId).toBe(MOBILE_GATE_ID);
    expect(result.severity).toBe("block");
    expect(result.message).toContain("won't publish yet");
    expect(result.message).toContain("scroll sideways");
    expect(result.findings.some((f) => f.blocking)).toBe(true);
    expect(result.screenshot).toContain("data:image/png;base64");
    expect(typeof result.checkedAt).toBe("string");
  });

  it("mentions additional blocking issues in the summary", async () => {
    const result = await runMobileLayoutGate({
      url: "https://example.com/",
      capture: async () =>
        cleanCapture(
          makeMetrics({
            hasViewportMeta: false,
            scrollWidth: 500,
            overflowElements: [
              {
                kind: "image",
                label: "hero",
                position: "near the top of the page",
                overflowPx: 110,
              },
            ],
          }),
        ),
    });
    expect(result.severity).toBe("block");
    expect(result.message).toContain("1 more mobile issue");
  });

  it("passes a clean layout", async () => {
    const result = await runMobileLayoutGate({
      url: "https://example.com/",
      capture: async () => cleanCapture(),
    });
    expect(result.severity).toBe("pass");
    expect(result.message).toContain("Looks good on a phone");
    expect(result.findings.filter((f) => f.blocking)).toEqual([]);
  });

  it("passes with advisory findings noted", async () => {
    const result = await runMobileLayoutGate({
      url: "https://example.com/",
      capture: async () =>
        cleanCapture(
          makeMetrics({
            smallTargets: [
              {
                kind: "link",
                label: "More",
                position: "near the bottom of the page",
                widthPx: 32,
                heightPx: 32,
              },
            ],
          }),
        ),
    });
    expect(result.severity).toBe("pass");
    expect(result.message).toContain("Minor note");
  });

  it("warns (never silently passes) when capture is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runMobileLayoutGate({
      url: "https://example.com/",
      capture: async () => null,
    });
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("without a mobile check");
    expect(result.findings).toEqual([]);
    warn.mockRestore();
  });

  it("warns when capture throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runMobileLayoutGate({
      url: "https://example.com/",
      capture: async () => {
        throw new Error("BROWSERBASE_API_KEY is not configured");
      },
    });
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("without a mobile check");
    // The failure was logged, not swallowed silently.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[mobile-gate]"));
    warn.mockRestore();
  });

  it("warns when the page loaded but could not be measured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runMobileLayoutGate({
      url: "https://example.com/",
      capture: async () => ({
        screenshot: "data:image/png;base64,AAA",
        metrics: null,
        pageError: "The page loaded but its layout could not be measured at phone width.",
      }),
    });
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("publishing without one");
    expect(result.screenshot).toContain("data:image/png;base64");
    warn.mockRestore();
  });

  it("renders at the phone viewport size", async () => {
    const seen: { width: number; height: number }[] = [];
    await runMobileLayoutGate({
      url: "https://example.com/",
      capture: async (_url, viewport) => {
        seen.push({ ...viewport });
        return cleanCapture();
      },
    });
    expect(seen).toEqual([{ width: MOBILE_GATE_VIEWPORT.width, height: MOBILE_GATE_VIEWPORT.height }]);
    expect(MOBILE_GATE_VIEWPORT.width).toBe(390);
  });
});

describe("collectMobileLayoutMetrics", () => {
  it("is a serializable pure function (safe for page.evaluate)", () => {
    expect(typeof collectMobileLayoutMetrics).toBe("function");
    // Must not close over module scope: re-parse from source.
    const rehydrated = new Function(`return (${collectMobileLayoutMetrics.toString()});`)();
    expect(typeof rehydrated).toBe("function");
    // References no Node-only globals in its source.
    const src = collectMobileLayoutMetrics.toString();
    expect(src).not.toMatch(/\brequire\b|\bprocess\.env\b|\bBuffer\b/);
  });
});
