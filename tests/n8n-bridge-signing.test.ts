/**
 * D4 helper tests (ART-20261022-013) — prepared 2026-10-22, run locally only.
 * Synthetic secret only; nothing here touches production.
 */
import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  ALLOWED_WEBHOOK_PATHS,
  MAX_FORWARD_BODY_BYTES,
  NEVER_FORWARD_HEADERS,
  buildForwardSigningHeaders,
  exceedsPayloadLimit,
  isAuthorizedWebhookPath,
} from "../src/lib/n8n-bridge-signing";
import { verifyWebhookSignature } from "../src/lib/n8n-webhook";

const SECRET = "test-secret-for-local-tests-only";
// verifyWebhookSignature reads the secret from env at call time.
process.env.LITT_N8N_BRIDGE_SECRET = SECRET;
const BODY = JSON.stringify({ prompt: "hello", context: "", model: "gpt-4o-mini" });
const NOW = 1_800_000_000;

describe("buildForwardSigningHeaders", () => {
  it("produces a signature the existing LiTT verifier accepts over the exact body", () => {
    const h = buildForwardSigningHeaders(SECRET, BODY, NOW, "req-1");
    expect(h["x-litt-timestamp"]).toBe(String(NOW));
    expect(h["x-litt-request-id"]).toBe("req-1");
    expect(verifyWebhookSignature(BODY, h["x-litt-signature"], NOW, NOW)).toBe(true);
  });

  it("does not verify against a tampered body (negative)", () => {
    const h = buildForwardSigningHeaders(SECRET, BODY, NOW, "req-1");
    expect(verifyWebhookSignature(BODY + " ", h["x-litt-signature"], NOW, NOW)).toBe(false);
  });

  it("rejects a stale timestamp at verification time (replay window)", () => {
    const h = buildForwardSigningHeaders(SECRET, BODY, NOW, "req-1");
    expect(verifyWebhookSignature(BODY, h["x-litt-signature"], NOW, NOW + 301)).toBe(false);
  });

  it("generates a unique request ID per call", () => {
    const a = buildForwardSigningHeaders(SECRET, BODY, NOW);
    const b = buildForwardSigningHeaders(SECRET, BODY, NOW);
    expect(a["x-litt-request-id"]).not.toBe(b["x-litt-request-id"]);
  });

  it("signs with plain HMAC-SHA256 over the raw body (scheme compatibility)", () => {
    const expected = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(buildForwardSigningHeaders(SECRET, BODY, NOW, "r")["x-litt-signature"]).toBe(expected);
  });

  it("fails closed when the secret is not configured", () => {
    expect(() => buildForwardSigningHeaders(undefined, BODY)).toThrow();
    expect(() => buildForwardSigningHeaders("", BODY)).toThrow();
  });
});

describe("isAuthorizedWebhookPath", () => {
  it("allows exactly the known n8n webhook paths", () => {
    for (const p of ALLOWED_WEBHOOK_PATHS) expect(isAuthorizedWebhookPath([p])).toBe(true);
  });
  it("rejects unknown, nested, empty, and case-variant paths", () => {
    expect(isAuthorizedWebhookPath(["evil"])).toBe(false);
    expect(isAuthorizedWebhookPath(["ai-orchestrate", "extra"])).toBe(false);
    expect(isAuthorizedWebhookPath([])).toBe(false);
    expect(isAuthorizedWebhookPath(undefined)).toBe(false);
    expect(isAuthorizedWebhookPath(["AI-Orchestrate"])).toBe(false);
  });
});

describe("exceedsPayloadLimit", () => {
  it("is byte-accurate at and over the limit", () => {
    expect(exceedsPayloadLimit("x".repeat(MAX_FORWARD_BODY_BYTES))).toBe(false);
    expect(exceedsPayloadLimit("x".repeat(MAX_FORWARD_BODY_BYTES + 1))).toBe(true);
    // 2-byte characters count as bytes, not characters
    expect(exceedsPayloadLimit("é".repeat(MAX_FORWARD_BODY_BYTES / 2 + 1))).toBe(true);
  });
});

describe("NEVER_FORWARD_HEADERS", () => {
  it("covers every caller-supplied signing/auth header", () => {
    for (const h of ["x-litt-signature", "x-litt-timestamp", "x-litt-request-id",
                     "x-n8n-bridge-secret", "authorization", "cookie"]) {
      expect(NEVER_FORWARD_HEADERS).toContain(h);
    }
  });
});
