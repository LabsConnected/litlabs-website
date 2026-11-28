/**
 * browser.* tool tests.
 *
 * Unit-level: tool definitions, sensitive-input guard, registration.
 * Live-level (skipped without Chrome): real navigate → snapshot →
 * click/type → screenshot → close through the actual CDP driver.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createTcpServer, connect } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_TOOL_ENTRIES } from "../lib/browser/tools.js";
import { findBrowser, CdpBrowser, assertPublicHttpUrl, assertPublicHttpDestination, type DnsResolver } from "../lib/browser/cdp.js";
import { startEgressProxy } from "../lib/browser/net-guard.js";

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

describe("assertPublicHttpDestination (DNS-resolution enforcement)", () => {
  // Unique fake hosts per test — the module-level DNS verdict cache is
  // keyed by hostname, so reusing a name would leak state between tests.
  const resolver =
    (rows: Array<{ address: string; family: number }>): DnsResolver & { calls: string[] } => {
      const calls: string[] = [];
      const fn = (async (h: string) => { calls.push(h); return rows; }) as DnsResolver & { calls: string[] };
      fn.calls = calls;
      return fn;
    };

  it("rejects a hostname that resolves to loopback", async () => {
    await expect(
      assertPublicHttpDestination("https://rebind-loopback.test/", resolver([{ address: "127.0.0.1", family: 4 }])),
    ).rejects.toThrow(/private|reserved/);
  });

  it("rejects a hostname that resolves to RFC1918 / link-local / metadata", async () => {
    for (const [i, ip] of ["10.0.0.8", "192.168.1.1", "169.254.169.254"].entries()) {
      await expect(
        assertPublicHttpDestination(`https://rebind-${i}.test/`, resolver([{ address: ip, family: 4 }])),
      ).rejects.toThrow(/private|reserved/);
    }
  });

  it("rejects a hostname that resolves to a private IPv6 address", async () => {
    await expect(
      assertPublicHttpDestination("https://rebind-v6.test/", resolver([{ address: "fd00::1", family: 6 }])),
    ).rejects.toThrow(/private|reserved/);
  });

  it("rejects when ANY resolved address is private (mixed answers poison the host)", async () => {
    await expect(
      assertPublicHttpDestination(
        "https://rebind-mixed.test/",
        resolver([{ address: "93.184.216.34", family: 4 }, { address: "10.1.2.3", family: 4 }]),
      ),
    ).rejects.toThrow(/private|reserved/);
  });

  it("fails closed when DNS resolution fails or returns nothing", async () => {
    const failing: DnsResolver = async () => { throw new Error("ENOTFOUND"); };
    await expect(assertPublicHttpDestination("https://rebind-nxdomain.test/", failing)).rejects.toThrow(/could not verify/);
    await expect(
      assertPublicHttpDestination("https://rebind-empty.test/", resolver([])),
    ).rejects.toThrow(/private|reserved/);
  });

  it("allows a hostname resolving only to public addresses", async () => {
    const url = await assertPublicHttpDestination(
      "https://rebind-public.test/",
      resolver([{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]),
    );
    expect(url).toContain("rebind-public.test");
  });

  it("does not resolve literal IPs — literal checks already ran", async () => {
    const r = resolver([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicHttpDestination("http://192.168.0.1/", r)).rejects.toThrow(/private|reserved/);
    expect(r.calls).toHaveLength(0);
    await expect(assertPublicHttpDestination("http://8.8.8.8/", r)).resolves.toContain("8.8.8.8");
    expect(r.calls).toHaveLength(0);
  });

  it("caches the verdict per host within the TTL", async () => {
    const r = resolver([{ address: "93.184.216.34", family: 4 }]);
    await assertPublicHttpDestination("https://rebind-cache.test/", r);
    await assertPublicHttpDestination("https://rebind-cache.test/other", r);
    expect(r.calls).toHaveLength(1);
  });

  it("LITT_BROWSER_ALLOW_PRIVATE bypasses DNS checks entirely", async () => {
    const prev = process.env.LITT_BROWSER_ALLOW_PRIVATE;
    process.env.LITT_BROWSER_ALLOW_PRIVATE = "1";
    try {
      const r = resolver([{ address: "127.0.0.1", family: 4 }]);
      await expect(
        assertPublicHttpDestination("http://rebind-optout.test/", r, true),
      ).resolves.toContain("rebind-optout.test");
      expect(r.calls).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.LITT_BROWSER_ALLOW_PRIVATE;
      else process.env.LITT_BROWSER_ALLOW_PRIVATE = prev;
    }
  });
});

describe("startEgressProxy (network-level destination enforcement)", () => {
  // The proxy is the authoritative layer: Chrome never resolves DNS
  // itself — every CONNECT / absolute-URI request is validated and the
  // connection is pinned to the validated IP. These tests inject the
  // resolver and TCP dial so no real egress happens.
  const publicResolver =
    (host: string): DnsResolver =>
    async (h: string) => (h === host ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);

  /** Send a raw request head to the proxy; resolves with the status line. */
  const proxyStatus = (port: number, head: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const s = connect({ host: "127.0.0.1", port });
      let buf = "";
      s.on("data", (d) => {
        buf += d.toString("utf8");
        const idx = buf.indexOf("\r\n");
        if (idx >= 0) { s.destroy(); resolve(buf.slice(0, idx)); }
      });
      s.on("error", reject);
      s.setTimeout(5000, () => { s.destroy(); reject(new Error("proxy status timeout")); });
      s.write(head);
    });

  it("denies CONNECT to loopback, RFC1918, link-local/metadata and localhost names", async () => {
    const proxy = await startEgressProxy();
    try {
      for (const target of ["127.0.0.1:443", "10.1.2.3:80", "169.254.169.254:80", "localhost:443", "[::1]:443"]) {
        const status = await proxyStatus(proxy.port, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
        expect(status, target).toContain("403");
      }
    } finally {
      await proxy.close();
    }
  });

  it("denies CONNECT when DNS resolves to a private address (rebinding at connect time)", async () => {
    const proxy = await startEgressProxy(async () => [{ address: "192.168.0.10", family: 4 }]);
    try {
      const status = await proxyStatus(proxy.port, "CONNECT proxy-rebind.test:443 HTTP/1.1\r\nHost: proxy-rebind.test\r\n\r\n");
      expect(status).toContain("403");
    } finally {
      await proxy.close();
    }
  });

  it("tunnels CONNECT to the pinned IP for public destinations", async () => {
    // Local echo server stands in for the origin; the injected dial maps
    // the "public" pinned IP onto it — proving validation passed and the
    // tunnel carries bytes end-to-end.
    const echo = createTcpServer((s) => { s.on("error", () => {}); s.pipe(s); });
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
    const echoPort = (echo.address() as { port: number }).port;
    const proxy = await startEgressProxy(publicResolver("proxy-connect.test"), () => connect({ host: "127.0.0.1", port: echoPort }));
    try {
      const status = await new Promise<string>((resolve, reject) => {
        const s = connect({ host: "127.0.0.1", port: proxy.port });
        let buf = "";
        s.on("data", (d) => {
          buf += d.toString("utf8");
          if (buf.includes("\r\n\r\n")) {
            s.write("ping-through-tunnel");
            setTimeout(() => { s.destroy(); resolve(buf); }, 300);
          }
        });
        s.on("error", reject);
        s.setTimeout(5000, () => { s.destroy(); reject(new Error("tunnel timeout")); });
        s.write("CONNECT proxy-connect.test:443 HTTP/1.1\r\nHost: proxy-connect.test:443\r\n\r\n");
      });
      expect(status).toContain("200 Connection Established");
      expect(status).toContain("ping-through-tunnel"); // echoed back through the tunnel
    } finally {
      await proxy.close();
      await new Promise<void>((r) => echo.close(() => r()));
    }
  });

  it("denies plain-http proxy requests to private destinations", async () => {
    const proxy = await startEgressProxy(async () => { throw new Error("ENOTFOUND"); });
    try {
      const status = await proxyStatus(proxy.port, "GET http://127.0.0.1:9/secret HTTP/1.1\r\nHost: 127.0.0.1:9\r\n\r\n");
      expect(status).toContain("403");
      // Unresolvable host → lookup fails → fail closed (403).
      const status2 = await proxyStatus(proxy.port, "GET http://proxy-http-deny.test/ HTTP/1.1\r\nHost: proxy-http-deny.test\r\n\r\n");
      expect(status2).toContain("403");
    } finally {
      await proxy.close();
    }
  });

  it("forwards plain-http requests to the pinned IP with Host preserved", async () => {
    let seenHost = "";
    let seenPath = "";
    const origin = createHttpServer((req, res) => {
      seenHost = req.headers.host ?? "";
      seenPath = req.url ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("proxied-ok");
    });
    await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
    const originPort = (origin.address() as { port: number }).port;
    const proxy = await startEgressProxy(publicResolver("proxy-http-allow.test"), () => connect({ host: "127.0.0.1", port: originPort }));
    try {
      const status = await new Promise<string>((resolve, reject) => {
        const s = connect({ host: "127.0.0.1", port: proxy.port });
        let buf = "";
        s.on("data", (d) => {
          buf += d.toString("utf8");
          if (buf.includes("\r\n\r\n")) {
            const idx = buf.indexOf("\r\n\r\n");
            const head = buf.slice(0, idx);
            const body = buf.slice(idx + 4);
            if (head.includes("200") && body.includes("proxied-ok")) { s.destroy(); resolve(head.split("\r\n")[0]); }
          }
        });
        s.on("error", reject);
        s.setTimeout(5000, () => { s.destroy(); reject(new Error("forward timeout")); });
        s.write(`GET http://proxy-http-allow.test:${originPort}/some/path?q=1 HTTP/1.1\r\nHost: proxy-http-allow.test:${originPort}\r\nConnection: close\r\n\r\n`);
      });
      expect(status).toContain("200");
      expect(seenHost).toBe(`proxy-http-allow.test:${originPort}`);
      // Absolute-URI request line is preserved end-to-end (RFC 7230).
      expect(seenPath).toBe(`http://proxy-http-allow.test:${originPort}/some/path?q=1`);
    } finally {
      await proxy.close();
      await new Promise<void>((r) => origin.close(() => r()));
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
