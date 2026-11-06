/**
 * D4 + v2 signing-protocol tests (ART-20261022-013/019).
 * Synthetic secret only; nothing here touches production.
 *
 * v2 protocol: HMAC-SHA256 over the canonical string
 *   litt-n8n-bridge-v2\n{timestamp}\n{requestId}\n{path}\n{exact body}
 * so timestamp, request ID and path are authenticated — a captured v1
 * (body-only) signature must never verify under v2.
 */
import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  ALLOWED_WEBHOOK_PATHS,
  MAX_FORWARD_BODY_BYTES,
  NEVER_FORWARD_HEADERS,
  buildForwardSigningHeaders,
  createInMemoryReplayClaim,
  exceedsPayloadLimit,
  isAuthorizedWebhookPath,
} from "../src/lib/n8n-bridge-signing";
import {
  buildCanonicalSigningStringV2,
  verifyWebhookSignatureV2,
} from "../src/lib/n8n-webhook";

// verifyWebhookSignatureV2 reads the secret from env at call time.
const SECRET = "test-secret-for-local-tests-only";
process.env.LITT_N8N_BRIDGE_SECRET = SECRET;

const BODY = JSON.stringify({ prompt: "hello", context: "", model: "gpt-4o-mini" });
const PATH = "ai-orchestrate";
const NOW = 1_800_000_000;

function v2Fields(h: ReturnType<typeof buildForwardSigningHeaders>) {
  return {
    body: BODY,
    signature: h["x-litt-signature"],
    timestamp: Number(h["x-litt-timestamp"]),
    requestId: h["x-litt-request-id"],
    path: PATH,
    now: NOW,
  };
}

describe("buildForwardSigningHeaders (v2)", () => {
  it("produces a v2 signature the verifier accepts, with version header", () => {
    const h = buildForwardSigningHeaders(SECRET, BODY, PATH, NOW, "req-1");
    expect(h["x-litt-signature-version"]).toBe("2");
    expect(h["x-litt-timestamp"]).toBe(String(NOW));
    expect(h["x-litt-request-id"]).toBe("req-1");
    expect(verifyWebhookSignatureV2(v2Fields(h))).toBe(true);
  });

  it("matches the cross-implementation test vector (canonical string built independently)", () => {
    // Canonical string constructed by hand here — NOT via the implementation —
    // so this pins the wire format shared with the n8n-side verifier.
    const canonical = ["litt-n8n-bridge-v2", String(NOW), "req-1", PATH, BODY].join("\n");
    const expected = createHmac("sha256", SECRET).update(canonical).digest("hex");
    expect(buildCanonicalSigningStringV2({ timestamp: NOW, requestId: "req-1", path: PATH, body: BODY })).toBe(canonical);
    const h = buildForwardSigningHeaders(SECRET, BODY, PATH, NOW, "req-1");
    expect(h["x-litt-signature"]).toBe(expected);
  });

  it("generates a unique request ID per call", () => {
    const a = buildForwardSigningHeaders(SECRET, BODY, PATH, NOW);
    const b = buildForwardSigningHeaders(SECRET, BODY, PATH, NOW);
    expect(a["x-litt-request-id"]).not.toBe(b["x-litt-request-id"]);
  });

  it("fails closed without a secret", () => {
    expect(() => buildForwardSigningHeaders(undefined, BODY, PATH, NOW)).toThrow();
  });
});

describe("verifyWebhookSignatureV2 — tamper matrix (the v1 weakness, closed)", () => {
  const h = buildForwardSigningHeaders(SECRET, BODY, PATH, NOW, "req-1");
  const base = v2Fields(h);

  it("rejects a modified timestamp (v1 allowed refreshing it freely)", () => {
    expect(verifyWebhookSignatureV2({ ...base, timestamp: NOW + 60, now: NOW + 60 })).toBe(false);
  });

  it("rejects a modified request ID", () => {
    expect(verifyWebhookSignatureV2({ ...base, requestId: "req-2" })).toBe(false);
  });

  it("rejects a modified path (cross-path replay)", () => {
    expect(verifyWebhookSignatureV2({ ...base, path: "github-sync" })).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignatureV2({ ...base, body: BODY + " " })).toBe(false);
  });

  it("rejects a stale timestamp even with an authentic signature (window)", () => {
    expect(verifyWebhookSignatureV2({ ...base, now: NOW + 301 })).toBe(false);
  });

  it("rejects missing request ID or path (fail closed)", () => {
    expect(verifyWebhookSignatureV2({ ...base, requestId: "" })).toBe(false);
    expect(verifyWebhookSignatureV2({ ...base, path: "" })).toBe(false);
  });

  it("rejects a v1 body-only signature (no legacy fallback)", () => {
    const v1sig = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(verifyWebhookSignatureV2({ ...base, signature: v1sig })).toBe(false);
  });
});

describe("createInMemoryReplayClaim — atomic one-time semantics", () => {
  it("claims exactly once per key inside the TTL, again after expiry", async () => {
    const claim = createInMemoryReplayClaim(300);
    expect(await claim("path:req-1", NOW)).toBe(true);
    expect(await claim("path:req-1", NOW + 1)).toBe(false);
    expect(await claim("path:req-2", NOW + 1)).toBe(true);
    expect(await claim("path:req-1", NOW + 301)).toBe(true);
  });
});

describe("path authorization + payload limit (unchanged from D4)", () => {
  it("allows only the three single-segment paths", () => {
    for (const p of ALLOWED_WEBHOOK_PATHS) expect(isAuthorizedWebhookPath([p])).toBe(true);
    expect(isAuthorizedWebhookPath(["evil"])).toBe(false);
    expect(isAuthorizedWebhookPath(["ai-orchestrate", "extra"])).toBe(false);
    expect(isAuthorizedWebhookPath([])).toBe(false);
    expect(isAuthorizedWebhookPath(undefined)).toBe(false);
  });

  it("enforces the byte-accurate limit", () => {
    expect(exceedsPayloadLimit("x".repeat(MAX_FORWARD_BODY_BYTES))).toBe(false);
    expect(exceedsPayloadLimit("x".repeat(MAX_FORWARD_BODY_BYTES + 1))).toBe(true);
    expect(exceedsPayloadLimit("é".repeat(MAX_FORWARD_BODY_BYTES))).toBe(true); // 2-byte chars
  });

  it("never forwards caller signing material", () => {
    for (const h of ["x-litt-signature", "x-litt-timestamp", "x-litt-request-id", "x-litt-signature-version", "x-n8n-bridge-secret", "authorization", "cookie"]) {
      expect(NEVER_FORWARD_HEADERS).toContain(h);
    }
  });
});
