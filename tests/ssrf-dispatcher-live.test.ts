/**
 * Dispatcher verification for the PR #736 SSRF guard.
 *
 * Hermetic: nothing in this file contacts the public internet. A local HTTP
 * server is the only peer. Public-address lookups are steered at the socket
 * onto that server so the allow-path can be proven without example.com.
 *
 * Connection-time checks go through `node:dns` (`validatingLookup`).
 * `validateOutboundHost` goes through `node:dns/promises`. The rebinding
 * test mocks those two modules differently: the first lookup is public,
 * the lookup at connect time is private, and the private server must see
 * zero connections.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import dns from "node:dns";
import net from "node:net";
import { AddressInfo } from "node:net";
import { request } from "undici";
import { createSsrfDispatcher, validateOutboundHost } from "@/lib/ssrf-guard";

const promisesLookup = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  promisesLookup.mockImplementation((...args: unknown[]) =>
    (actual.lookup as (...a: unknown[]) => Promise<unknown>)(...args),
  );
  return {
    ...actual,
    lookup: promisesLookup,
    default: { ...actual, lookup: promisesLookup },
  };
});

const PUBLIC_IP = "93.184.216.34";
const FIXTURE_HOST = "public.fixture.test";
const REBIND_HOST = "rebind.example";

const dispatcher = createSsrfDispatcher();
let server: http.Server;
let port = 0;
let connections = 0;

const realLookup = dns.lookup.bind(dns);

async function tryFetch(url: string): Promise<{ status?: number; error?: string }> {
  try {
    const res = await request(url, { dispatcher, method: "GET" });
    await res.body.dump();
    return { status: res.statusCode };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function installLookup(
  decide: (hostname: string) => { address: string; family: number } | null,
) {
  return vi.spyOn(dns, "lookup").mockImplementation(((hostname: string, options: unknown, cb?: unknown) => {
    const callback = (typeof options === "function" ? options : cb) as (...a: unknown[]) => void;
    const opts = typeof options === "function" ? {} : (options as { all?: boolean });
    const decided = decide(hostname);
    if (!decided) return realLookup(hostname, options as never, callback as never);
    const row = [{ address: decided.address, family: decided.family }];
    return opts.all ? callback(null, row) : callback(null, row[0].address, row[0].family);
  }) as never);
}

describe("ssrf dispatcher — live sockets", () => {
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    server.on("connection", () => {
      connections++;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await dispatcher.close();
    server?.closeAllConnections?.();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("opens ZERO connections to a literal 127.0.0.1 target", async () => {
    const before = connections;
    const r = await tryFetch(`http://127.0.0.1:${port}/`);
    expect(r.status).toBeUndefined();
    expect(r.error).toMatch(/Blocked destination/);
    expect(connections - before).toBe(0);
  });

  it("rejects a hostname whose connect-time lookup (node:dns) is private", async () => {
    const spy = installLookup((hostname) =>
      hostname === "attacker-controlled.example" ? { address: "127.0.0.1", family: 4 } : null,
    );
    try {
      const before = connections;
      const r = await tryFetch(`http://attacker-controlled.example:${port}/`);
      expect(r.status).toBeUndefined();
      expect(r.error).toMatch(/Blocked destination/);
      expect(connections - before).toBe(0);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects when the first lookup is public and the connect-time lookup is private", async () => {
    promisesLookup.mockResolvedValueOnce([{ address: PUBLIC_IP, family: 4 }]);
    const connectSpy = installLookup((hostname) =>
      hostname === REBIND_HOST ? { address: "127.0.0.1", family: 4 } : null,
    );
    try {
      const verdict = await validateOutboundHost(REBIND_HOST);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) expect(verdict.addresses).toEqual([PUBLIC_IP]);
      expect(promisesLookup).toHaveBeenCalled();

      const before = connections;
      const r = await tryFetch(`http://${REBIND_HOST}:${port}/`);
      expect(r.status).toBeUndefined();
      expect(r.error).toMatch(/Blocked destination/);
      expect(connectSpy).toHaveBeenCalled();
      expect(connections - before).toBe(0);
    } finally {
      connectSpy.mockRestore();
    }
  });

  it("allows a public lookup and serves it from a local fixture (no public internet)", async () => {
    const accepted: string[] = [];
    const lookupSpy = installLookup((hostname) =>
      hostname === FIXTURE_HOST ? { address: PUBLIC_IP, family: 4 } : null,
    );
    // undici connects with host = the URL hostname and our validating lookup.
    // After that lookup accepts PUBLIC_IP, steer the socket at the local
    // fixture. The public address is never dialed.
    const originalConnect = net.connect;
    const connectSpy = vi.spyOn(net, "connect").mockImplementation(((options: net.NetConnectOpts, ...rest: unknown[]) => {
      if (
        options &&
        typeof options === "object" &&
        "lookup" in options &&
        typeof options.lookup === "function" &&
        "host" in options &&
        options.host === FIXTURE_HOST
      ) {
        const inner = options.lookup;
        const wrapped: net.LookupFunction = (hostname, lookupOptions, callback) => {
          inner(hostname, lookupOptions, ((err: Error | null, address: unknown, _family?: number) => {
            if (err) {
              callback(err, "", 0);
              return;
            }
            if (Array.isArray(address)) {
              for (const row of address as Array<{ address: string }>) accepted.push(row.address);
              callback(null, [{ address: "127.0.0.1", family: 4 }], 4);
              return;
            }
            accepted.push(String(address));
            callback(null, "127.0.0.1", 4);
          }) as never);
        };
        return originalConnect({ ...options, lookup: wrapped });
      }
      return originalConnect(options, ...(rest as []));
    }) as typeof net.connect);
    try {
      const before = connections;
      const r = await tryFetch(`http://${FIXTURE_HOST}:${port}/`);
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(200);
      expect(accepted).toContain(PUBLIC_IP);
      expect(connections - before).toBeGreaterThan(0);
      expect(lookupSpy).toHaveBeenCalled();
    } finally {
      connectSpy.mockRestore();
      lookupSpy.mockRestore();
    }
  });
});
