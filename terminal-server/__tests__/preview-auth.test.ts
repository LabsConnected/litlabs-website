/**
 * Regression tests for the preview access-token check (fail-closed).
 *
 * GET /preview/:workspaceId/* previously used `if (expectedToken && ...)`:
 * when PREVIEW_ACCESS_TOKEN was unset, authentication was silently skipped
 * and any workspace's running preview was proxied publicly. The check now
 * denies every request (503) when the token is not configured.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkPreviewToken } from "../preview-auth";
import { createWorkspacePreviewToken } from "../preview/preview-token";

const TERMINAL_SECRET = "terminal-auth-secret-with-at-least-32-chars";

describe("checkPreviewToken", () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("fails CLOSED when PREVIEW_ACCESS_TOKEN is unset — even with an empty token", () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const result = checkPreviewToken("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.errorCode).toBe("preview_token_not_configured");
    }
  });

  it("fails CLOSED when PREVIEW_ACCESS_TOKEN is unset — even with a guess", () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const result = checkPreviewToken("attacker-guess");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
    }
  });

  it("rejects a wrong token with 401 when configured", () => {
    process.env.PREVIEW_ACCESS_TOKEN = "correct-token";
    const result = checkPreviewToken("wrong-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.errorCode).toBe("invalid_preview_token");
    }
  });

  it("rejects an empty token with 401 when configured", () => {
    process.env.PREVIEW_ACCESS_TOKEN = "correct-token";
    const result = checkPreviewToken("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("accepts the correct token", () => {
    process.env.PREVIEW_ACCESS_TOKEN = "correct-token";
    expect(checkPreviewToken("correct-token")).toEqual({ ok: true });
  });
});

describe("checkPreviewToken — signed per-workspace channel (Phase 2)", () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
    process.env.TERMINAL_AUTH_SECRET = TERMINAL_SECRET;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  function signedToken(workspaceId = "ws-proj_1"): string {
    return createWorkspacePreviewToken({
      userId: "user_owner",
      projectId: "proj_1",
      workspaceId,
    });
  }

  it("accepts a signed token for its own workspace — with NO legacy token configured (retirement path)", () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    expect(checkPreviewToken(signedToken(), "ws-proj_1")).toEqual({ ok: true });
  });

  it("rejects a signed token presented for a different workspace", () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const result = checkPreviewToken(signedToken("ws-proj_1"), "ws-proj_2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects garbage with 401 when the signed channel is configured but the token verifies for nothing", () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const result = checkPreviewToken("attacker-guess", "ws-proj_1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.errorCode).toBe("invalid_preview_token");
    }
  });

  it("still fails CLOSED with 503 when neither channel is configured", () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    delete process.env.TERMINAL_AUTH_SECRET;
    const result = checkPreviewToken("attacker-guess", "ws-proj_1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.errorCode).toBe("preview_token_not_configured");
    }
  });

  it("legacy global token keeps working during the transition", () => {
    process.env.PREVIEW_ACCESS_TOKEN = "correct-token";
    expect(checkPreviewToken("correct-token", "ws-proj_1")).toEqual({ ok: true });
    // And a signed token is accepted alongside it.
    expect(checkPreviewToken(signedToken(), "ws-proj_1")).toEqual({ ok: true });
  });
});
