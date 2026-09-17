import { describe, it, expect } from "vitest";
import {
  getSafeRedirectUrl,
  DEFAULT_POST_LOGIN_DESTINATION,
} from "./safe-redirect-url";

describe("getSafeRedirectUrl", () => {
  it("accepts ordinary relative paths", () => {
    expect(getSafeRedirectUrl("/studio")).toBe("/studio");
    expect(getSafeRedirectUrl("/pricing")).toBe("/pricing");
    expect(getSafeRedirectUrl("/pricing?plan=pro")).toBe("/pricing?plan=pro");
    expect(getSafeRedirectUrl("/")).toBe("/");
  });

  it("rejects absolute URLs to attacker hosts", () => {
    expect(getSafeRedirectUrl("https://evil.com")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
    expect(getSafeRedirectUrl("http://evil.com/studio")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
  });

  it("rejects protocol-relative URLs", () => {
    expect(getSafeRedirectUrl("//evil.com")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
    expect(getSafeRedirectUrl("//evil.com/studio")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
  });

  it("rejects dangerous schemes", () => {
    expect(getSafeRedirectUrl("javascript:alert(1)")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
    expect(getSafeRedirectUrl("JaVaScRiPt:alert(1)")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
    expect(getSafeRedirectUrl("data:text/html,<h1>x</h1>")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
  });

  it("rejects backslash and control-character tricks", () => {
    expect(getSafeRedirectUrl("/\\evil.com")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
    expect(getSafeRedirectUrl("\\/evil.com")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
  });

  it("rejects encoded absolute URLs", () => {
    expect(
      getSafeRedirectUrl(encodeURIComponent("https://evil.com/studio")),
    ).toBe(DEFAULT_POST_LOGIN_DESTINATION);
    expect(getSafeRedirectUrl("%2F%2Fevil.com")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
  });

  it("rejects userinfo and subdomain lookalikes", () => {
    expect(getSafeRedirectUrl("https://www.litlabs.net@evil.com/")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
    expect(getSafeRedirectUrl("https://www.litlabs.net.evil.com/")).toBe(
      DEFAULT_POST_LOGIN_DESTINATION,
    );
  });

  it("falls back for empty, null, undefined, and garbage", () => {
    expect(getSafeRedirectUrl("")).toBe(DEFAULT_POST_LOGIN_DESTINATION);
    expect(getSafeRedirectUrl(null)).toBe(DEFAULT_POST_LOGIN_DESTINATION);
    expect(getSafeRedirectUrl(undefined)).toBe(DEFAULT_POST_LOGIN_DESTINATION);
    expect(getSafeRedirectUrl("   ")).toBe(DEFAULT_POST_LOGIN_DESTINATION);
    expect(getSafeRedirectUrl("notaurl")).toBe(DEFAULT_POST_LOGIN_DESTINATION);
    expect(getSafeRedirectUrl("%ZZ")).toBe(DEFAULT_POST_LOGIN_DESTINATION);
  });

  it("preserves absolute URLs on the app's own trusted hosts (Clerk OAuth flow)", () => {
    const oauth =
      "https://clerk.litlabs.net/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fwww.litlabs.net%2Foauth-consent";
    expect(getSafeRedirectUrl(oauth)).toBe(oauth);
    expect(getSafeRedirectUrl("https://www.litlabs.net/studio")).toBe(
      "https://www.litlabs.net/studio",
    );
  });
});
