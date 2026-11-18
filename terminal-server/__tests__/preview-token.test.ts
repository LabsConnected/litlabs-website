/**
 * Per-workspace signed preview tokens (Phase 2, design note §3.5).
 *
 * The terminal verifier must accept tokens minted in the WEB app's
 * format (src/lib/projects/preview-token.ts). These tests build
 * tokens with an INDEPENDENT implementation of the documented
 * algorithm (raw node:crypto, straight from the spec) so a drift in
 * either implementation fails loudly instead of silently breaking
 * previews:
 *   key   = HMAC-SHA256(TERMINAL_AUTH_SECRET, "littree-preview-token-key-v1")
 *   token = base64url(JSON{sub,aud:"littree-preview",iat,exp,pid,wid,ast})
 *         + "." + base64url(HMAC-SHA256(key, payload))
 */

import { createHmac } from "crypto";
import { describe, it, expect } from "vitest";
import {
  createWorkspacePreviewToken,
  isWorkspacePreviewTokenConfigured,
  verifyWorkspacePreviewToken,
} from "../preview/preview-token";

const SECRET = "terminal-auth-secret-with-at-least-32-chars";
const ENV = { TERMINAL_AUTH_SECRET: SECRET };
const NOW = 1_800_000_000; // fixed clock for determinism

/** Independent re-implementation of the web minter (spec-only). */
function mintWebStyleToken(
  payload: Record<string, unknown>,
  secret: string = SECRET,
): string {
  const key = createHmac("sha256", secret)
    .update("littree-preview-token-key-v1")
    .digest();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function webPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: "user_owner",
    aud: "littree-preview",
    iat: NOW,
    exp: NOW + 300,
    pid: "proj_1",
    wid: "ws-proj_1",
    ast: ["/index.html"],
    ...overrides,
  };
}

describe("verifyWorkspacePreviewToken", () => {
  it("accepts a web-format token bound to the requested workspace", () => {
    const token = mintWebStyleToken(webPayload());
    expect(verifyWorkspacePreviewToken(token, "ws-proj_1", ENV, NOW)).toEqual({
      userId: "user_owner",
      projectId: "proj_1",
      workspaceId: "ws-proj_1",
    });
  });

  it("rejects the same token for a DIFFERENT workspace (the Phase 2 point)", () => {
    const token = mintWebStyleToken(webPayload());
    expect(verifyWorkspacePreviewToken(token, "ws-proj_2", ENV, NOW)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mintWebStyleToken(webPayload({ exp: NOW - 1 }));
    expect(verifyWorkspacePreviewToken(token, "ws-proj_1", ENV, NOW)).toBeNull();
  });

  it("rejects a tampered payload and a wrong-secret signature", () => {
    const good = mintWebStyleToken(webPayload());
    const [payload, sig] = good.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify(webPayload({ sub: "user_attacker" })),
    ).toString("base64url");
    expect(verifyWorkspacePreviewToken(`${forgedPayload}.${sig}`, "ws-proj_1", ENV, NOW)).toBeNull();
    void payload;
    const wrongSecret = mintWebStyleToken(webPayload(), "a-different-secret-also-32-chars-long!!");
    expect(verifyWorkspacePreviewToken(wrongSecret, "ws-proj_1", ENV, NOW)).toBeNull();
  });

  it("rejects wrong audience and missing scope claims", () => {
    expect(
      verifyWorkspacePreviewToken(
        mintWebStyleToken(webPayload({ aud: "something-else" })),
        "ws-proj_1",
        ENV,
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyWorkspacePreviewToken(
        mintWebStyleToken(webPayload({ wid: "" })),
        "ws-proj_1",
        ENV,
        NOW,
      ),
    ).toBeNull();
  });

  it("rejects garbage and unsigned input", () => {
    expect(verifyWorkspacePreviewToken("not-a-token", "ws-proj_1", ENV, NOW)).toBeNull();
    expect(verifyWorkspacePreviewToken("", "ws-proj_1", ENV, NOW)).toBeNull();
  });

  it("is unconfigured (always null) when the secret is too short or absent", () => {
    const token = mintWebStyleToken(webPayload());
    expect(isWorkspacePreviewTokenConfigured(ENV)).toBe(true);
    expect(isWorkspacePreviewTokenConfigured({ TERMINAL_AUTH_SECRET: "short" })).toBe(false);
    expect(isWorkspacePreviewTokenConfigured({})).toBe(false);
    expect(
      verifyWorkspacePreviewToken(token, "ws-proj_1", { TERMINAL_AUTH_SECRET: "short" }, NOW),
    ).toBeNull();
  });

  it("round-trips through the terminal mint helper (same format)", () => {
    const token = createWorkspacePreviewToken(
      { userId: "user_owner", projectId: "proj_1", workspaceId: "ws-proj_1" },
      ENV,
      300,
      NOW,
    );
    expect(verifyWorkspacePreviewToken(token, "ws-proj_1", ENV, NOW + 10)).toEqual({
      userId: "user_owner",
      projectId: "proj_1",
      workspaceId: "ws-proj_1",
    });
    // And the web-style minter accepts the same secret derivation:
    // a token from the independent implementation verifies identically.
    const webToken = mintWebStyleToken(webPayload());
    expect(verifyWorkspacePreviewToken(webToken, "ws-proj_1", ENV, NOW)).not.toBeNull();
  });
});
