/**
 * Live-socket verification of the PR #736 SSRF dispatcher. Proves that
 * blocked destinations open ZERO connections on a real local HTTP server,
 * and that a hostname resolving to a private address at connect time is
 * rejected (DNS-rebinding analogue — exercises the `node:dns`
 * `validatingLookup` path that unit tests mocking `dns/promises` miss).
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import http from "node:http";
import dns from "node:dns";
import { AddressInfo } from "node:net";
import { request } from "undici";
import { createSsrfDispatcher } from "@/lib/ssrf-guard";

const dispatcher = createSsrfDispatcher();
let server: http.Server;
let port = 0;
let connections = 0;

const realLookup = dns.lookup;

async function tryFetch(url: string): Promise<{ status?: number; error?: string }> {
  try {
    const res = await request(url, { dispatcher, method: "GET" });
    await res.body.dump();
    return { status: res.statusCode };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

describe("ssrf dispatcher — live sockets", () => {
  it("setup: local server", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pwned");
    });
    server.on("connection", () => connections++);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  it("opens ZERO connections to a literal 127.0.0.1 target", async () => {
    const before = connections;
    const r = await tryFetch(`http://127.0.0.1:${port}/`);
    expect(r.status).toBeUndefined();
    expect(r.error).toMatch(/Blocked destination/);
    expect(connections - before).toBe(0);
  });

  it("rejects a public-looking hostname that resolves to 127.0.0.1 at connect time", async () => {
    const spy = vi.spyOn(dns, "lookup").mockImplementation(((hostname: string, options: unknown, cb?: unknown) => {
      const callback = (typeof options === "function" ? options : cb) as (...a: unknown[]) => void;
      const opts = typeof options === "function" ? {} : (options as { all?: boolean });
      if (hostname === "attacker-controlled.example") {
        const addr = [{ address: "127.0.0.1", family: 4 }];
        return opts.all ? callback(null, addr) : callback(null, addr[0].address, addr[0].family);
      }
      return realLookup(hostname, options as never, callback as never);
    }) as never);
    try {
      const before = connections;
      const r = await tryFetch(`http://attacker-controlled.example:${port}/`);
      expect(r.status).toBeUndefined();
      expect(r.error).toMatch(/Blocked destination/);
      expect(connections - before).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("allows a real public host (positive control, single outbound GET)", async () => {
    const r = await tryFetch("http://example.com/");
    // example.com returns 200 or a redirect; either proves connect+response worked.
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(500);
  });

  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await dispatcher.close();
  });
});
