/**
 * D4 route tests (ART-20261022-013) — prepared 2026-10-22, run locally only.
 * Exercises the FIXED bridge route with a mocked next/server and a mocked
 * fetch. Synthetic secret only; no production calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const SECRET = "test-secret-for-local-tests-only";
// The route reads env at module scope; set it in vi.hoisted so it lands
// before the route import executes (static imports are hoisted above
// module-level statements).
vi.hoisted(() => {
  process.env.LITT_N8N_BRIDGE_SECRET = "test-secret-for-local-tests-only";
  process.env.N8N_WEBHOOK_URL = "https://n8n.internal.example";
  process.env.LITT_N8N_LEGACY_SHARED_SECRET = "legacy-test-secret";
});

vi.mock("next/server", () => {
  class NextResponse {
    body: unknown; status: number; headers: unknown;
    constructor(body: unknown, init?: { status?: number; headers?: unknown }) {
      this.body = body; this.status = init?.status ?? 200; this.headers = init?.headers;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(JSON.stringify(body), { status: init?.status ?? 200 });
    }
  }
  return { NextRequest: class {}, NextResponse };
});

import { POST } from "../src/app/api/n8n/[...path]/route";

const fetchMock = vi.fn(async () => ({
  status: 200,
  headers: { get: (n: string) => (n === "content-type" ? "application/json" : null) },
  text: async () => JSON.stringify({ ok: true }),
}));
// @ts-expect-error test global
globalThis.fetch = fetchMock;

function sign(body: string, ts: number) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function makeReq(body: string, headers: Record<string, string>, method = "POST") {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    headers: { get: (n: string) => map.get(n.toLowerCase()) ?? null },
    text: async () => body,
  } as never;
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

const BODY = JSON.stringify({ prompt: "hello", model: "gpt-4o-mini" });

beforeEach(() => fetchMock.mockClear());

describe("bridge authentication (unchanged behavior, regression-pinned)", () => {
  it("rejects a request with no authentication and never calls n8n", async () => {
    const res = (await POST(makeReq(BODY, {}), ctx(["ai-orchestrate"]))) as unknown as { status: number };
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature and never calls n8n (negative)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const req = makeReq(BODY, { "x-litt-signature": "deadbeef", "x-litt-timestamp": String(now) });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as { status: number };
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a replayed request: valid signature but stale timestamp", async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const req = makeReq(BODY, { "x-litt-signature": sign(BODY, stale), "x-litt-timestamp": String(stale) });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as { status: number };
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("D4 forwarding behavior", () => {
  it("forwards with a FRESH server signature and request ID; caller auth headers are not forwarded", async () => {
    const now = Math.floor(Date.now() / 1000);
    const req = makeReq(BODY, {
      "x-litt-signature": sign(BODY, now),
      "x-litt-timestamp": String(now),
      "x-litt-request-id": "attacker-controlled-id",
      authorization: "Bearer attacker",
      cookie: "session=attacker",
      "content-type": "application/json",
    });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as { status: number };
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://n8n.internal.example/webhook/ai-orchestrate");
    expect(init.body).toBe(BODY);
    const h = init.headers;
    // fresh signature verifies over the exact forwarded body, at the forwarded timestamp
    const fwdTs = Number(h["x-litt-timestamp"]);
    expect(Math.abs(Math.floor(Date.now() / 1000) - fwdTs)).toBeLessThan(10);
    expect(h["x-litt-signature"]).toBe(sign(BODY, fwdTs));
    expect(h["x-litt-request-id"]).toBeTruthy();
    expect(h["x-litt-request-id"]).not.toBe("attacker-controlled-id");
    expect(h["authorization"]).toBeUndefined();
    expect(h["cookie"]).toBeUndefined();
    expect(h["x-n8n-bridge-secret"]).toBeUndefined();
  });

  it("legacy-secret callers also get a fresh generated signature, never the legacy header forwarded", async () => {
    const req = makeReq(BODY, { "x-n8n-bridge-secret": SECRET, "content-type": "application/json" });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as { status: number };
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers["x-n8n-bridge-secret"]).toBeUndefined();
    expect(init.headers["x-litt-signature"]).toBe(sign(BODY, Number(init.headers["x-litt-timestamp"])));
  });

  it("rejects an authenticated caller asking for an unauthorized path (authorization)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const req = makeReq(BODY, { "x-litt-signature": sign(BODY, now), "x-litt-timestamp": String(now) });
    const res = (await POST(req, ctx(["some-other-workflow"]))) as unknown as { status: number };
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload from an authenticated caller (payload limit)", async () => {
    const big = JSON.stringify({ prompt: "x".repeat(300 * 1024) });
    const now = Math.floor(Date.now() / 1000);
    const req = makeReq(big, { "x-litt-signature": sign(big, now), "x-litt-timestamp": String(now) });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as { status: number };
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
