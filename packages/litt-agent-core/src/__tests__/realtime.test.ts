/**
 * Realtime internet capability — acceptance tests.
 *
 * Proves the shared realtime layer:
 *   - SSRF defense blocks private/internal/metadata/localhost/file://
 *   - safeFetch enforces timeout, size cap, redirect re-validation
 *   - weatherForecast returns structured NWS data (mocked upstream)
 *   - webSearch is truthful when empty (no invented results)
 *   - the default ToolRegistry exposes web.fetch/web.search/weather.forecast
 *   - tool handlers route errors truthfully (never blank)
 *
 * Uses node:test mock to stub global fetch, and the dnsResolver injection
 * seam on safeFetch/weatherForecast/webSearch to avoid real DNS. No real
 * network calls are made.
 */

import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  safeFetch,
  assertSafeUrl,
  isPrivateIp,
  webSearch,
  weatherForecast,
  SafeFetchError,
  createDefaultRegistry,
  REALTIME_TOOL_IDS,
  type DnsResolver,
} from "../index.js";

// ─── Mock helpers ──────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function makeJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeTextResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });
}

function makeRedirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** Install a fetch mock. Returns the mock.fn so tests can assert calls. */
function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof mock.fn> {
  const fn = mock.fn(impl);
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

/** A fake resolver that returns the given public addresses. */
function publicResolver(addresses: string[] = ["93.184.216.34"]): DnsResolver {
  return async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
}

/** A fake resolver that returns a private address (SSRF probe). */
function privateResolver(privateIp = "10.0.0.5"): DnsResolver {
  return async () => [{ address: privateIp, family: privateIp.includes(":") ? 6 : 4 }];
}

/** A fake resolver that simulates DNS resolution failure. */
function failingResolver(): DnsResolver {
  return async () => { throw new Error("ENOTFOUND"); };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── isPrivateIp ───────────────────────────────────────────────────

describe("realtime — isPrivateIp", () => {
  it("blocks RFC1918, loopback, link-local, metadata, CGNAT", () => {
    assert.equal(isPrivateIp("10.0.0.1"), true);
    assert.equal(isPrivateIp("172.16.0.1"), true);
    assert.equal(isPrivateIp("172.31.255.255"), true);
    assert.equal(isPrivateIp("192.168.1.1"), true);
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("169.254.169.254"), true); // cloud metadata
    assert.equal(isPrivateIp("0.0.0.0"), true);
    assert.equal(isPrivateIp("100.64.0.1"), true); // CGNAT
    // 172.32 is NOT private
    assert.equal(isPrivateIp("172.32.0.1"), false);
  });

  it("allows public IPv4", () => {
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("1.1.1.1"), false);
    assert.equal(isPrivateIp("104.16.123.96"), false);
  });

  it("blocks IPv6 loopback/link-local/unique-local, allows public", () => {
    assert.equal(isPrivateIp("::1"), true);
    assert.equal(isPrivateIp("fe80::1"), true);
    assert.equal(isPrivateIp("fd12:3456::1"), true);
    assert.equal(isPrivateIp("fc00::1"), true);
    assert.equal(isPrivateIp("::ffff:127.0.0.1"), true); // v4-mapped loopback
    assert.equal(isPrivateIp("2606:4700:4700::1111"), false); // public (Cloudflare)
  });
});

// ─── assertSafeUrl ─────────────────────────────────────────────────

describe("realtime — assertSafeUrl (static checks, no DNS)", () => {
  it("blocks non-http(s) schemes", () => {
    assert.equal(assertSafeUrl("file:///etc/passwd").safe, false);
    assert.equal(assertSafeUrl("ftp://example.com/x").safe, false);
    assert.equal(assertSafeUrl("gopher://x").safe, false);
  });

  it("blocks localhost + .localhost", () => {
    assert.equal(assertSafeUrl("http://localhost/").safe, false);
    assert.equal(assertSafeUrl("http://app.localhost/").safe, false);
    assert.equal(assertSafeUrl("http://localhost.localdomain/").safe, false);
  });

  it("blocks private IP literals (v4 + v6)", () => {
    assert.equal(assertSafeUrl("http://127.0.0.1/").safe, false);
    assert.equal(assertSafeUrl("http://10.0.0.1/").safe, false);
    assert.equal(assertSafeUrl("http://192.168.1.1/").safe, false);
    assert.equal(assertSafeUrl("http://169.254.169.254/").safe, false);
    assert.equal(assertSafeUrl("http://[::1]/").safe, false);
  });

  it("blocks URLs with userinfo credentials", () => {
    assert.equal(assertSafeUrl("http://user:pass@example.com/").safe, false);
  });

  it("allows public http(s) URLs", () => {
    assert.equal(assertSafeUrl("https://example.com/").safe, true);
    assert.equal(assertSafeUrl("http://api.weather.gov/points/40,-90").safe, true);
    assert.equal(assertSafeUrl("https://api.duckduckgo.com/?q=test").safe, true);
  });

  it("rejects invalid URLs", () => {
    assert.equal(assertSafeUrl("not a url").safe, false);
    assert.equal(assertSafeUrl("http://").safe, false);
  });
});

// ─── safeFetch — SSRF + behavior ───────────────────────────────────

describe("realtime — safeFetch SSRF + behavior", () => {
  afterEach(restoreFetch);

  it("blocks a hostname that DNS-resolves to a private IP", async () => {
    mockFetch(() => Promise.resolve(makeJsonResponse({ ok: true })));
    await assert.rejects(
      () => safeFetch("https://internal.example.com/", { dnsResolver: privateResolver() }),
      (err: unknown) => {
        assert.ok(err instanceof SafeFetchError);
        assert.equal((err as SafeFetchError).kind, "blocked");
        assert.match((err as Error).message, /private\/internal IP/);
        return true;
      },
    );
  });

  it("blocks a DNS resolution failure", async () => {
    await assert.rejects(
      () => safeFetch("https://nonexistent.invalid/", { dnsResolver: failingResolver() }),
      (err: unknown) => {
        assert.ok(err instanceof SafeFetchError);
        assert.equal((err as SafeFetchError).kind, "blocked");
        return true;
      },
    );
  });

  it("re-validates redirects through the SSRF pipeline (redirect to private blocked)", async () => {
    // First hop: public host → 302 redirect to http://127.0.0.1 (private).
    // 127.0.0.1 is an IP literal — assertSafeUrl catches it on the next hop.
    mockFetch((url: string) => {
      if (url.includes("example.com")) return Promise.resolve(makeRedirect("http://127.0.0.1/secret"));
      return Promise.resolve(makeJsonResponse({ leaked: true }));
    });
    await assert.rejects(
      () => safeFetch("https://example.com/", { dnsResolver: publicResolver() }),
      (err: unknown) => {
        assert.ok(err instanceof SafeFetchError);
        assert.equal((err as SafeFetchError).kind, "blocked");
        return true;
      },
    );
  });

  it("follows a safe redirect and returns the final body", async () => {
    mockFetch((url: string) => {
      if (url.includes("example.com/old")) return Promise.resolve(makeRedirect("https://example.com/new"));
      if (url.includes("example.com/new")) return Promise.resolve(makeTextResponse("final body"));
      throw new Error(`unexpected url ${url}`);
    });
    const res = await safeFetch("https://example.com/old", { dnsResolver: publicResolver() });
    assert.equal(res.status, 200);
    assert.equal(res.content, "final body");
    assert.equal(res.ok, true);
  });

  it("enforces the response-size cap (truncation)", async () => {
    const big = "x".repeat(1024);
    mockFetch(() => Promise.resolve(makeTextResponse(big)));
    const res = await safeFetch("https://example.com/big", { maxBytes: 100, dnsResolver: publicResolver() });
    assert.equal(res.truncated, true);
    assert.ok(res.bytes <= 100);
  });

  it("enforces a timeout (AbortError → timeout kind)", async () => {
    // The mock must honor the abort signal — otherwise the never-resolving
    // promise hangs the test runner. Real fetch rejects on abort; the mock
    // replicates that by listening to init.signal.
    mockFetch((_url, init) => new Promise<Response>((_, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal) {
        if (signal.aborted) reject(new DOMException("aborted", "AbortError"));
        else signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }
    }));
    await assert.rejects(
      () => safeFetch("https://example.com/slow", { timeoutMs: 50, dnsResolver: publicResolver() }),
      (err: unknown) => {
        assert.ok(err instanceof SafeFetchError);
        assert.equal((err as SafeFetchError).kind, "timeout");
        return true;
      },
    );
  });

  it("returns content + metadata for a normal public fetch", async () => {
    mockFetch(() => Promise.resolve(makeJsonResponse({ hello: "world" })));
    const res = await safeFetch("https://example.com/api", { dnsResolver: publicResolver() });
    assert.equal(res.status, 200);
    assert.match(res.contentType, /application\/json/);
    assert.match(res.content, /hello/);
  });
});

// ─── weatherForecast (mocked upstream) ─────────────────────────────

describe("realtime — weatherForecast", () => {
  afterEach(restoreFetch);

  function mockWeatherUpstream(): void {
    mockFetch((url: string) => {
      if (url.startsWith("https://api.zippopotam.us/us/")) {
        return Promise.resolve(makeJsonResponse({
          "post code": "49456",
          places: [{ latitude: "43.1264", longitude: "-86.1718", "place name": "Spring Lake", "state abbreviation": "MI" }],
        }));
      }
      if (url.includes("api.weather.gov/points/")) {
        return Promise.resolve(makeJsonResponse({
          properties: { forecast: "https://api.weather.gov/gridbox/GRR/40,60/forecast" },
        }, 200, { "content-type": "application/geo+json" }));
      }
      if (url.includes("api.weather.gov/gridbox/")) {
        return Promise.resolve(makeJsonResponse({
          updated: "2026-08-20T10:00:00+00:00",
          properties: {
            periods: [
              {
                number: 1, name: "Today", startTime: "2026-08-20T10:00:00-04:00", endTime: "2026-08-20T18:00:00-04:00",
                isDaytime: true, temperature: 78, temperatureUnit: "F", windSpeed: "10 mph", windDirection: "SW",
                shortForecast: "Sunny", detailedForecast: "Sunny, with a high near 78.",
                probabilityOfPrecipitation: { value: 5 },
              },
              {
                number: 2, name: "Tonight", startTime: "2026-08-20T18:00:00-04:00", endTime: "2026-08-21T06:00:00-04:00",
                isDaytime: false, temperature: 62, temperatureUnit: "F", windSpeed: "5 mph", windDirection: "S",
                shortForecast: "Mostly Clear", detailedForecast: "Mostly clear, with a low around 62.",
                probabilityOfPrecipitation: { value: 0 },
              },
              {
                number: 3, name: "Tomorrow", startTime: "2026-08-21T10:00:00-04:00", endTime: "2026-08-21T18:00:00-04:00",
                isDaytime: true, temperature: 81, temperatureUnit: "F", windSpeed: "8 mph", windDirection: "W",
                shortForecast: "Partly Sunny", detailedForecast: "Partly sunny, with a high near 81.",
                probabilityOfPrecipitation: { value: 20 },
              },
            ],
          },
        }, 200, { "content-type": "application/geo+json" }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it("returns structured NWS forecast for a valid ZIP", async () => {
    mockWeatherUpstream();
    const res = await weatherForecast("49456", { dnsResolver: publicResolver() });
    assert.equal(res.location.zip, "49456");
    assert.equal(res.location.place, "Spring Lake");
    assert.equal(res.location.state, "MI");
    assert.equal(res.source.provider, "National Weather Service");
    assert.ok(res.periods.length >= 3);
    const tomorrow = res.periods.find((p) => p.name === "Tomorrow");
    assert.ok(tomorrow, "expected a Tomorrow period");
    assert.equal(tomorrow!.temperature, 81);
    assert.equal(tomorrow!.temperatureUnit, "F");
    assert.equal(tomorrow!.probabilityOfPrecipitation, 20);
    assert.equal(res.generatedAt, "2026-08-20T10:00:00+00:00");
  });

  it("rejects an invalid ZIP (not 5 digits)", async () => {
    await assert.rejects(() => weatherForecast("abc"), SafeFetchError);
    await assert.rejects(() => weatherForecast("123456"), SafeFetchError);
  });

  it("fails safely when the geocoder returns no places", async () => {
    mockFetch(() => Promise.resolve(makeJsonResponse({ "post code": "00000", places: [] })));
    await assert.rejects(
      () => weatherForecast("00000", { dnsResolver: publicResolver() }),
      (err: unknown) => {
        assert.ok(err instanceof SafeFetchError);
        assert.match((err as Error).message, /No location found/);
        return true;
      },
    );
  });

  it("fails safely on a malformed NWS forecast (no periods)", async () => {
    mockFetch((url: string) => {
      if (url.startsWith("https://api.zippopotam.us/")) {
        return Promise.resolve(makeJsonResponse({
          "post code": "49456",
          places: [{ latitude: "43.1", longitude: "-86.1", "place name": "Spring Lake", "state abbreviation": "MI" }],
        }));
      }
      if (url.includes("/points/")) {
        return Promise.resolve(makeJsonResponse({ properties: { forecast: "https://api.weather.gov/gridbox/X/1,1/forecast" } }, 200, { "content-type": "application/geo+json" }));
      }
      return Promise.resolve(makeJsonResponse({ updated: "x", properties: { periods: [] } }, 200, { "content-type": "application/geo+json" }));
    });
    await assert.rejects(
      () => weatherForecast("49456", { dnsResolver: publicResolver() }),
      (err: unknown) => {
        assert.ok(err instanceof SafeFetchError);
        assert.match((err as Error).message, /no periods/);
        return true;
      },
    );
  });
});

// ─── webSearch (mocked upstream) ───────────────────────────────────

describe("realtime — webSearch", () => {
  afterEach(restoreFetch);

  it("returns structured results when DuckDuckGo has an abstract", async () => {
    mockFetch(() => Promise.resolve(makeJsonResponse({
      AbstractText: "TypeScript is a typed superset of JavaScript.",
      AbstractSource: "Wikipedia",
      AbstractURL: "https://en.wikipedia.org/wiki/TypeScript",
      Answer: "",
      RelatedTopics: [{ Text: "TS handbook", FirstURL: "https://www.typescriptlang.org/docs/" }],
    })));
    const res = await webSearch("typescript", { dnsResolver: publicResolver() });
    assert.equal(res.empty, false);
    assert.equal(res.abstract, "TypeScript is a typed superset of JavaScript.");
    assert.equal(res.abstractSource, "Wikipedia");
    assert.equal(res.abstractUrl, "https://en.wikipedia.org/wiki/TypeScript");
    assert.ok(res.relatedTopics.length >= 1);
  });

  it("is truthful when no instant answer exists (empty=true, no invented data)", async () => {
    mockFetch(() => Promise.resolve(makeJsonResponse({
      AbstractText: "", AbstractSource: "", AbstractURL: "", Answer: "", RelatedTopics: [],
    })));
    const res = await webSearch("some obscure nonsense query xyzzy", { dnsResolver: publicResolver() });
    assert.equal(res.empty, true);
    assert.equal(res.answer, null);
    assert.equal(res.abstract, null);
    assert.equal(res.relatedTopics.length, 0);
  });

  it("rejects an empty query", async () => {
    await assert.rejects(() => webSearch(""), SafeFetchError);
    await assert.rejects(() => webSearch("   "), SafeFetchError);
  });

  it("accepts DuckDuckGo application/x-javascript content-type (valid JSON body)", async () => {
    // DuckDuckGo Instant Answers sometimes responds with
    // content-type: application/x-javascript even though the body is JSON.
    // The fix accepts this content type but still JSON.parse the body.
    mockFetch(() => Promise.resolve(makeJsonResponse({
      AbstractText: "Test answer",
      AbstractSource: "TestSource",
      AbstractURL: "https://example.com/test",
      Answer: "",
      RelatedTopics: [],
    }, 200, { "content-type": "application/x-javascript" })));
    const res = await webSearch("test query", { dnsResolver: publicResolver() });
    assert.equal(res.empty, false);
    assert.equal(res.abstract, "Test answer");
  });

  it("accepts DuckDuckGo application/javascript content-type (valid JSON body)", async () => {
    mockFetch(() => Promise.resolve(makeJsonResponse({
      AbstractText: "JS content type test",
      AbstractSource: "TestSource",
      AbstractURL: "https://example.com/js",
      Answer: "",
      RelatedTopics: [],
    }, 200, { "content-type": "application/javascript" })));
    const res = await webSearch("js content type", { dnsResolver: publicResolver() });
    assert.equal(res.empty, false);
    assert.equal(res.abstract, "JS content type test");
  });

  it("rejects malformed/non-JSON body even with accepted content-type", async () => {
    mockFetch(() => Promise.resolve(new Response("not valid json {{{", {
      status: 200,
      headers: { "content-type": "application/x-javascript" },
    })));
    await assert.rejects(
      () => webSearch("malformed test", { dnsResolver: publicResolver() }),
      (err: unknown) => {
        assert.ok(err instanceof SafeFetchError);
        assert.match((err as Error).message, /Malformed/);
        return true;
      },
    );
  });
});

// ─── Default ToolRegistry parity ───────────────────────────────────

describe("realtime — default ToolRegistry parity", () => {
  it("exposes web.fetch, web.search, weather.forecast in the default registry", () => {
    const registry = createDefaultRegistry();
    const ids = registry.list().map((t) => t.id);
    for (const id of REALTIME_TOOL_IDS) {
      assert.ok(ids.includes(id), `default registry should include ${id}`);
      const entry = registry.get(id);
      assert.ok(entry, `${id} should have an entry`);
      assert.equal(entry!.metadata.readOnly, true, `${id} must be read-only`);
      assert.equal(entry!.metadata.mutating, false, `${id} must be non-mutating`);
    }
  });

  it("weather.forecast handler returns a truthful error on bad ZIP (no blank result)", async () => {
    const registry = createDefaultRegistry();
    const ctx = { cwd: ".", projectId: null, userId: null, shell: { execute: async () => ({ ok: true }) } as never };
    const res = await registry.execute("weather.forecast", ctx, { zip: "nope" });
    assert.equal(res.status, "failed");
    assert.equal(res.success, false);
    assert.ok(res.message.length > 0, "error must not be blank");
    assert.match(res.message, /ZIP/);
  });

  it("web.fetch handler returns a truthful SSRF block for localhost", async () => {
    const registry = createDefaultRegistry();
    const ctx = { cwd: ".", projectId: null, userId: null, shell: { execute: async () => ({ ok: true }) } as never };
    const res = await registry.execute("web.fetch", ctx, { url: "http://localhost/admin" });
    assert.equal(res.status, "failed");
    assert.equal(res.success, false);
    assert.ok(res.message.length > 0);
    assert.match(res.message, /Blocked/);
  });

  it("web.search handler returns a truthful error on missing query", async () => {
    const registry = createDefaultRegistry();
    const ctx = { cwd: ".", projectId: null, userId: null, shell: { execute: async () => ({ ok: true }) } as never };
    const res = await registry.execute("web.search", ctx, {});
    assert.equal(res.status, "failed");
    assert.equal(res.success, false);
    assert.ok(res.message.length > 0);
  });
});
