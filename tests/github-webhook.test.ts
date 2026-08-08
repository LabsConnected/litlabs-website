// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhookSignature } from "../src/lib/github-app";

const SECRET = "github-webhook-secret-for-testing";

function signPayload(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  return "sha256=" + hmac.digest("hex");
}

describe("github-app webhook verification", () => {
  const originalEnv = process.env.GITHUB_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = originalEnv;
  });

  it("accepts a valid signature", () => {
    const payload = JSON.stringify({ action: "opened" });
    const signature = signPayload(payload, SECRET);

    expect(verifyWebhookSignature(payload, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const payload = JSON.stringify({ action: "opened" });

    expect(verifyWebhookSignature(payload, "sha256=invalid")).toBe(false);
  });

  it("rejects a signature with a different secret", () => {
    const payload = JSON.stringify({ action: "opened" });
    const signature = signPayload(payload, "other-secret");

    expect(verifyWebhookSignature(payload, signature)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const payload = JSON.stringify({ action: "opened" });
    const signature = signPayload(payload, SECRET);

    expect(verifyWebhookSignature(payload + "0", signature)).toBe(false);
  });

  it("throws when the webhook secret is not configured", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "";

    expect(() => verifyWebhookSignature("{}", "sha256=anything")).toThrow(
      "GITHUB_WEBHOOK_SECRET is not set",
    );
  });
});
