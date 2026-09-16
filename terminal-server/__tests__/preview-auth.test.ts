/**
 * Regression tests for the preview access-token check (fail-closed).
 *
 * GET /preview/:workspaceId/* previously used `if (expectedToken && ...)`:
 * when PREVIEW_ACCESS_TOKEN was unset, authentication was silently skipped
 * and any workspace's running preview was proxied publicly. The check now
 * denies every request (503) when the token is not configured.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkPreviewToken,
  previewSessionCookieName,
  previewSessionSetCookie,
  readPreviewSessionCookie,
} from "../preview-auth";

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

  it("round-trips a workspace-scoped session cookie", () => {
    const cookie = previewSessionSetCookie("ws-1", "correct-token");
    expect(cookie).toContain(`${previewSessionCookieName("ws-1")}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/preview/ws-1");
    expect(readPreviewSessionCookie(cookie, "ws-1")).toBe("correct-token");
    expect(readPreviewSessionCookie(cookie, "ws-2")).toBe("");
  });
});
