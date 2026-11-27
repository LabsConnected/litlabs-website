/**
 * browser.* tool tests.
 *
 * Unit-level: tool definitions, sensitive-input guard, registration.
 * Live-level (skipped without Chrome): real navigate → snapshot →
 * click/type → screenshot → close through the actual CDP driver.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_TOOL_ENTRIES } from "../lib/browser/tools.js";
import { findBrowser, CdpBrowser, assertPublicHttpUrl } from "../lib/browser/cdp.js";

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

  it("marks consequential tools mutating and inspection tools read-only", () => {
    // navigate is mutating: loading a remote page is a consequential act
    // and must pass the SEC-4 approval gate like click/type/close.
    expect(BROWSER_TOOL_ENTRIES["browser.navigate"].metadata.mutating).toBe(true);
    expect(BROWSER_TOOL_ENTRIES["browser.navigate"].metadata.readOnly).toBe(false);
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

  it("refuses private-network and metadata destinations before launch", async () => {
    const ctx = { cwd: process.cwd(), projectId: null, userId: null, shell: null as never };
    for (const url of [
      "http://localhost:3000/admin",
      "http://127.0.0.1:4001/health",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.1/",
      "http://10.0.0.5/internal",
      "http://[::1]/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "file:///C:/Windows/win.ini",
      "javascript:alert(1)",
    ]) {
      const res = await BROWSER_TOOL_ENTRIES["browser.navigate"].handler(ctx, { url });
      expect(res.success, url).toBe(false);
      expect(res.message, url).toMatch(/refused|http\(s\)|invalid/i);
    }
  });
});

describe("assertPublicHttpUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(assertPublicHttpUrl("https://example.com/")).toContain("example.com");
    expect(assertPublicHttpUrl("http://8.8.8.8/dns")).toContain("8.8.8.8");
  });

  it("blocks loopback, RFC1918, link-local, CGNAT, multicast", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1",
      "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
      "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1",
    ]) {
      const proto = ip.includes(":") ? "http://[" : "http://";
      const suffix = ip.includes(":") ? "]/" : "/";
      expect(() => assertPublicHttpUrl(`${proto}${ip}${suffix}`), ip).toThrow(/refused|private|reserved/);
    }
  });

  it("honors LITT_BROWSER_ALLOW_PRIVATE=1 opt-out", () => {
    const prev = process.env.LITT_BROWSER_ALLOW_PRIVATE;
    process.env.LITT_BROWSER_ALLOW_PRIVATE = "1";
    try {
      expect(assertPublicHttpUrl("http://127.0.0.1:3000/")).toContain("127.0.0.1");
      expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/http\(s\)/);
    } finally {
      if (prev === undefined) delete process.env.LITT_BROWSER_ALLOW_PRIVATE;
      else process.env.LITT_BROWSER_ALLOW_PRIVATE = prev;
    }
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

  it("close() kills the browser process — no orphan", async () => {
    const b = await CdpBrowser.launch({});
    // Reach into the private field for verification only.
    const proc = (b as unknown as { proc: { pid?: number } | null }).proc;
    const pid = proc?.pid;
    expect(pid).toBeTypeOf("number");
    await b.close();
    // Give the OS a moment to reap, then confirm the pid is gone.
    await new Promise((r) => setTimeout(r, 800));
    let alive = true;
    try {
      process.kill(pid!, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 60_000);

  it("browser session persists cookies across close/relaunch via session.json", async () => {
    // Chrome's own profile flush is unreliable, so session state is
    // exported explicitly to <cwd>/.litt/browser/session.json on close
    // and re-imported on the next browser launch. This exercises the
    // real tool path: handler → getBrowser → closeBrowser → handler.
    const { closeBrowser } = await import("../lib/browser/tools.js");
    const workdir = mkdtempSync(join(tmpdir(), "litt-browser-session-"));
    const ctx = { cwd: workdir, projectId: null, userId: null, shell: null as never };
    try {
      // Session 1: navigate, plant a cookie, close (persists session.json).
      const nav1 = await BROWSER_TOOL_ENTRIES["browser.navigate"].handler(ctx, { url: "https://example.com" });
      expect(nav1.success).toBe(true);
      const plant = await BROWSER_TOOL_ENTRIES["browser.extract"].handler(ctx, {
        expression: `document.cookie = "litt_session_probe=tool123; path=/"`,
      });
      expect(plant.success).toBe(true);
      await closeBrowser();

      const { existsSync, readFileSync } = await import("node:fs");
      const sf = join(workdir, ".litt", "browser", "session.json");
      expect(existsSync(sf)).toBe(true);
      expect(readFileSync(sf, "utf8")).toContain("litt_session_probe");

      // Session 2: a fresh browser launches and restores the cookie.
      const nav2 = await BROWSER_TOOL_ENTRIES["browser.navigate"].handler(ctx, { url: "https://example.com" });
      expect(nav2.success).toBe(true);
      const read = await BROWSER_TOOL_ENTRIES["browser.extract"].handler(ctx, {
        expression: `document.cookie`,
      });
      expect(read.success).toBe(true);
      expect(JSON.stringify(read.data)).toContain("litt_session_probe=tool123");
      await closeBrowser();
    } finally {
      await closeBrowser().catch(() => {});
      for (let i = 0; i < 10; i++) {
        try { rmSync(workdir, { recursive: true, force: true }); break; }
        catch { await new Promise((r) => setTimeout(r, 500)); }
      }
    }
  }, 90_000);
});
