/**
 * browser.* tool tests.
 *
 * Unit-level: tool definitions, sensitive-input guard, registration.
 * Live-level (skipped without Chrome): real navigate → snapshot →
 * click/type → screenshot → close through the actual CDP driver.
 */

import { describe, it, expect } from "vitest";
import { BROWSER_TOOL_ENTRIES } from "../lib/browser/tools.js";
import { findBrowser, CdpBrowser } from "../lib/browser/cdp.js";

const LIVE = Boolean(findBrowser());

describe("browser tool registry", () => {
  it("registers the full browser.* family", () => {
    for (const id of [
      "browser.navigate", "browser.snapshot", "browser.screenshot",
      "browser.click", "browser.type", "browser.scroll",
      "browser.extract", "browser.close",
    ]) {
      expect(BROWSER_TOOL_ENTRIES[id], id).toBeDefined();
      expect(BROWSER_TOOL_ENTRIES[id].definition.id).toBe(id);
    }
  });

  it("marks input tools mutating and inspection tools read-only", () => {
    expect(BROWSER_TOOL_ENTRIES["browser.navigate"].metadata.readOnly).toBe(true);
    expect(BROWSER_TOOL_ENTRIES["browser.snapshot"].metadata.readOnly).toBe(true);
    expect(BROWSER_TOOL_ENTRIES["browser.screenshot"].metadata.readOnly).toBe(true);
    expect(BROWSER_TOOL_ENTRIES["browser.scroll"].metadata.readOnly).toBe(true);
    expect(BROWSER_TOOL_ENTRIES["browser.extract"].metadata.readOnly).toBe(true);
    for (const id of ["browser.click", "browser.type", "browser.close"]) {
      expect(BROWSER_TOOL_ENTRIES[id].metadata.mutating, id).toBe(true);
    }
  });

  it("rejects non-http navigate URLs without launching a browser", async () => {
    const res = await BROWSER_TOOL_ENTRIES["browser.navigate"].handler(
      { cwd: process.cwd(), projectId: null, userId: null, shell: null as never },
      { url: "file:///etc/passwd" },
    );
    expect(res.success).toBe(false);
    expect(res.message).toContain("http(s)");
  });
});

describe.skipIf(!LIVE)("live CDP browser (real Chrome)", () => {
  it("navigate → snapshot → click → type → screenshot → close", async () => {
    const b = await CdpBrowser.launch({ width: 1280, height: 800 });
    try {
      const nav = await b.navigate("https://example.com");
      expect(nav.url).toContain("example.com");
      expect(nav.title).toBe("Example Domain");

      const snap = await b.snapshot();
      expect(snap.elements.some((e) => e.tag === "a")).toBe(true);

      // Real click via Input.dispatchMouseEvent on the "Learn more" link.
      const link = snap.elements.find((e) => e.tag === "a");
      expect(link).toBeDefined();
      await b.click(link!.selector);
      await new Promise((r) => setTimeout(r, 800));
      const after = await b.evaluate<{ url: string }>("({url: location.href})");
      expect(after.url).toContain("iana.org");

      // Screenshot produces a real PNG.
      const png = await b.screenshot();
      expect(png.length).toBeGreaterThan(1000);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    } finally {
      await b.close();
    }
  }, 60_000);
});
