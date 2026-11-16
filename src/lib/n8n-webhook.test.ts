import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  MAX_SIGNATURE_AGE_SECONDS,
  type N8nWebhookPayload,
} from "./n8n-webhook";

const TEST_SECRET = "test-bridge-secret-not-a-real-key";

const samplePayload: N8nWebhookPayload = {
  userId: "user_test",
  projectId: "proj_test",
  missionId: null,
  eventType: "lead.created",
  approvedAction: "send_welcome_email",
  callbackUrl: "https://www.litlabs.net/api/n8n/callback",
  idempotencyKey: "00000000-0000-4000-8000-000000000000",
  data: { email: "newuser@example.com" },
};

beforeEach(() => {
  vi.stubEnv("LITT_N8N_BRIDGE_SECRET", TEST_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyWebhookSignature", () => {
  it("accepts a freshly signed payload", () => {
    const { body, signature, timestamp } = signWebhookPayload(samplePayload);
    expect(verifyWebhookSignature(body, signature, timestamp)).toBe(true);
  });

  it("rejects a replayed request with a forged fresh timestamp", () => {
    // Capture a valid request signed "in the past", then replay it with the
    // timestamp rewritten to now. The signature must NOT verify — the
    // timestamp is part of the HMAC message.
    const body = JSON.stringify(samplePayload);
    const { signature } = signWebhookPayload(samplePayload);

    const forgedTimestamp = Math.floor(Date.now() / 1000) + 60;
    expect(
      verifyWebhookSignature(body, signature, forgedTimestamp, forgedTimestamp),
    ).toBe(false);
  });

  it("rejects a signature computed over a different timestamp", () => {
    const { body, signature, timestamp } = signWebhookPayload(samplePayload);
    expect(verifyWebhookSignature(body, signature, timestamp + 60)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const { signature, timestamp } = signWebhookPayload(samplePayload);
    const tampered = JSON.stringify({ ...samplePayload, approvedAction: "delete_all" });
    expect(verifyWebhookSignature(tampered, signature, timestamp)).toBe(false);
  });

  it("rejects timestamps older than the replay window", () => {
    const { body, signature, timestamp } = signWebhookPayload(samplePayload);
    const later = timestamp + MAX_SIGNATURE_AGE_SECONDS + 1;
    expect(verifyWebhookSignature(body, signature, timestamp, later)).toBe(false);
  });

  it("rejects timestamps too far in the future", () => {
    const { body, signature, timestamp } = signWebhookPayload(samplePayload);
    const earlier = timestamp - MAX_SIGNATURE_AGE_SECONDS - 1;
    expect(verifyWebhookSignature(body, signature, timestamp, earlier)).toBe(false);
  });

  it("rejects when the bridge secret is not configured", () => {
    const { body, signature, timestamp } = signWebhookPayload(samplePayload);
    vi.unstubAllEnvs();
    expect(verifyWebhookSignature(body, signature, timestamp)).toBe(false);
  });
});

describe("signWebhookPayload", () => {
  it("throws when the bridge secret is not configured", () => {
    vi.unstubAllEnvs();
    expect(() => signWebhookPayload(samplePayload)).toThrow(
      /LITT_N8N_BRIDGE_SECRET is not configured/,
    );
  });
});
