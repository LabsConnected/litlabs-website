/**
 * Bridge route tests — D4 forwarding + v2 signing protocol
 * (ART-20261022-013/019). Mocked next/server + fetch. Synthetic secret
 * only; no production calls.
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

const BODY = JSON.stringify({ prompt: "hello", model: "gpt-4o-mini" });
let counter = 0;

function canonical(body: string, ts: number, reqId: string, path: string) {
  return ["litt-n8n-bridge-v2", String(ts), reqId, path, body].join("\n");
}
function signV2(body: string, ts: number, reqId: string, path: string) {
  return createHmac("sha256", SECRET).update(canonical(body, ts, reqId, path)).digest("hex");
}
function signedHeaders(body: string, path: string, over: Partial<Record<string, string>> = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const reqId = `req-${++counter}`;
  return {
    "x-litt-signature": signV2(body, ts, reqId, path),
    "x-litt-timestamp": String(ts),
    "x-litt-request-id": reqId,
    "x-litt-signature-version": "2",
    "content-type": "application/json",
    ...over,
  };
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
type Res = { status: number };

beforeEach(() => fetchMock.mockClear());

describe("bridge authentication — v2 only", () => {
  it("rejects a request with no authentication and never calls n8n", async () => {
    const res = (await POST(makeReq(BODY, {}), ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature and never calls n8n (negative)", async () => {
    const req = makeReq(BODY, signedHeaders(BODY, "ai-orchestrate", { "x-litt-signature": "deadbeef" }));
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (authentic signature, old window)", async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const reqId = `req-${++counter}`;
    const req = makeReq(BODY, {
      "x-litt-signature": signV2(BODY, stale, reqId, "ai-orchestrate"),
      "x-litt-timestamp": String(stale),
      "x-litt-request-id": reqId,
      "x-litt-signature-version": "2",
    });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a REFRESHED timestamp on a captured signature (the v1 weakness)", async () => {
    // Attacker captures a valid v2 request, then edits the timestamp header
    // to look fresh. Under v1 the signature still verified; v2 binds the
    // timestamp into the MAC, so this must fail.
    const captured = signedHeaders(BODY, "ai-orchestrate");
    const forged = { ...captured, "x-litt-timestamp": String(Math.floor(Date.now() / 1000) + 30) };
    const res = (await POST(makeReq(BODY, forged), ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a modified request ID on a captured signature", async () => {
    const captured = signedHeaders(BODY, "ai-orchestrate");
    const forged = { ...captured, "x-litt-request-id": "some-other-id" };
    const res = (await POST(makeReq(BODY, forged), ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a signature replayed against a different path", async () => {
    const headers = signedHeaders(BODY, "ai-orchestrate");
    const res = (await POST(makeReq(BODY, headers), ctx(["github-sync"]))) as unknown as Res;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a v1 body-only signature (no silent legacy fallback)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const v1sig = createHmac("sha256", SECRET).update(BODY).digest("hex");
    const req = makeReq(BODY, {
      "x-litt-signature": v1sig,
      "x-litt-timestamp": String(now),
      "x-litt-request-id": `req-${++counter}`,
    });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an exact replay of a valid request (atomic claim)", async () => {
    const headers = signedHeaders(BODY, "ai-orchestrate");
    const first = (await POST(makeReq(BODY, headers), ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(first.status).toBe(200);
    const second = (await POST(makeReq(BODY, headers), ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(second.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("D4 forwarding behavior (v2)", () => {
  it("forwards with a FRESH v2 signature; caller auth headers are not forwarded", async () => {
    const extra: Record<string, string> = {};
    extra["authorization"] = "Bearer x";
    extra["cookie"] = "a=b";
    const caller = signedHeaders(BODY, "ai-orchestrate", extra);
    const res = (await POST(makeReq(BODY, caller), ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://n8n.internal.example/webhook/ai-orchestrate");
    expect(init.body).toBe(BODY);
    const h = init.headers;
    expect(h["x-litt-signature-version"]).toBe("2");
    expect(h["x-litt-request-id"]).toBeTruthy();
    expect(h["x-litt-request-id"]).not.toBe(caller["x-litt-request-id"]);
    // the forwarded signature verifies under v2 for the forwarded fields
    expect(h["x-litt-signature"]).toBe(
      signV2(BODY, Number(h["x-litt-timestamp"]), h["x-litt-request-id"], "ai-orchestrate"),
    );
    expect(h["x-litt-signature"]).not.toBe(caller["x-litt-signature"]);
    expect(h["authorization"]).toBeUndefined();
    expect(h["cookie"]).toBeUndefined();
    expect(h["x-n8n-bridge-secret"]).toBeUndefined();
  });

  it("legacy-secret callers are re-signed with v2, never the legacy header forwarded", async () => {
    const req = makeReq(BODY, { "x-n8n-bridge-secret": SECRET, "content-type": "application/json" });
    const res = (await POST(req, ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers["x-n8n-bridge-secret"]).toBeUndefined();
    expect(init.headers["x-litt-signature-version"]).toBe("2");
    expect(init.headers["x-litt-signature"]).toBe(
      signV2(BODY, Number(init.headers["x-litt-timestamp"]), init.headers["x-litt-request-id"], "ai-orchestrate"),
    );
  });

  it("rejects an authenticated caller asking for an unauthorized path (authorization)", async () => {
    const headers = signedHeaders(BODY, "some-other-workflow");
    const res = (await POST(makeReq(BODY, headers), ctx(["some-other-workflow"]))) as unknown as Res;
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload from an authenticated caller (payload limit)", async () => {
    const big = JSON.stringify({ prompt: "x".repeat(300 * 1024) });
    const headers = signedHeaders(big, "ai-orchestrate");
    const res = (await POST(makeReq(big, headers), ctx(["ai-orchestrate"]))) as unknown as Res;
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
