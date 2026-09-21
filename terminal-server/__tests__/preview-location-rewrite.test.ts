/**
 * Regression tests for the Clerk-handshake mount escape (2026-09-21).
 *
 * Production defect: loading the Studio preview of a Clerk-protected
 * Next.js app issued an upstream 307 to
 *   https://clerk.litlabs.net/v1/client/handshake?redirect_url=<…>
 * whose redirect_url was https://terminal.litlabs.net/?token=… — the
 * /preview/:workspaceId mount prefix was lost, because the proxy strips it
 * before forwarding and Clerk rebuilds the URL from forwarded headers.
 * rewritePreviewLocation passed the absolute clerk.litlabs.net Location
 * through untouched, the browser completed the handshake, landed on the
 * bare origin root, and Express answered "Cannot GET /".
 *
 * Fix: rewritePreviewLocation now takes the proxy's public origin and
 *   (a) re-homes absolute self-origin redirects under the mount, and
 *   (b) re-homes redirect_url params that point at the public origin but
 *       outside the mount, so auth handshakes land back inside the mount.
 * Genuinely external URLs and params are never touched.
 */

import { describe, it, expect } from "vitest";

import { rewritePreviewLocation } from "../preview/asset-urls";

const WS = "ws-3648d2ea-b9c5004a";
const TOKEN = "tok-9";
const PORT = 4100;
const ORIGIN = "https://terminal.litlabs.net";
const M = `/preview/${WS}`;

const OPTS = { workspaceId: WS, token: TOKEN, upstreamPort: PORT, publicOrigin: ORIGIN };
const NO_ORIGIN = { workspaceId: WS, token: TOKEN, upstreamPort: PORT };

/** The exact upstream 307 captured in production (token value simplified). */
const HANDSHAKE =
  "https://clerk.litlabs.net/v1/client/handshake" +
  "?redirect_url=" +
  encodeURIComponent(`${ORIGIN}/?token=${TOKEN}&studioRefresh=1`) +
  "&__clerk_api_version=2025-11-10" +
  "&suffixed_cookies=true" +
  "&__clerk_hs_reason=client-uat-but-no-session-token" +
  "&format=nonce";

function redirectUrlParam(rewritten: string): string | null {
  return new URL(rewritten).searchParams.get("redirect_url");
}

describe("rewritePreviewLocation — Clerk handshake mount escape", () => {
  it("re-homes the redirect_url param under the mount, outer URL untouched", () => {
    const out = rewritePreviewLocation(HANDSHAKE, OPTS);
    const u = new URL(out);
    expect(u.origin).toBe("https://clerk.litlabs.net");
    expect(u.pathname).toBe("/v1/client/handshake");
    // The handshake's own params survive.
    expect(u.searchParams.get("__clerk_hs_reason")).toBe("client-uat-but-no-session-token");
    expect(u.searchParams.get("format")).toBe("nonce");
    // …but the landing URL now stays inside the mount with the token.
    expect(redirectUrlParam(out)).toBe(`${ORIGIN}${M}/?token=${TOKEN}&studioRefresh=1`);
  });

  it("leaves the handshake alone when no publicOrigin is configured", () => {
    expect(rewritePreviewLocation(HANDSHAKE, NO_ORIGIN)).toBe(HANDSHAKE);
  });

  it("does not touch a redirect_url pointing at a genuinely external origin", () => {
    const loc =
      "https://clerk.litlabs.net/v1/client/handshake?redirect_url=" +
      encodeURIComponent("https://app.example.com/?token=x");
    expect(rewritePreviewLocation(loc, OPTS)).toBe(loc);
  });

  it("does not touch a redirect_url already inside the mount", () => {
    const loc =
      "https://clerk.litlabs.net/v1/client/handshake?redirect_url=" +
      encodeURIComponent(`${ORIGIN}${M}/?token=${TOKEN}`);
    expect(rewritePreviewLocation(loc, OPTS)).toBe(loc);
  });

  it("does not touch a relative redirect_url value", () => {
    const loc = "https://clerk.litlabs.net/v1/client/handshake?redirect_url=%2Fsign-in";
    expect(rewritePreviewLocation(loc, OPTS)).toBe(loc);
  });

  it("merges the preview token into a re-homed redirect_url missing it", () => {
    const loc =
      "https://clerk.litlabs.net/v1/client/handshake?redirect_url=" +
      encodeURIComponent(`${ORIGIN}/`);
    expect(redirectUrlParam(rewritePreviewLocation(loc, OPTS))).toBe(
      `${ORIGIN}${M}/?token=${TOKEN}`,
    );
  });

  it("re-homes the param when the outer redirect is itself self-origin absolute", () => {
    const loc =
      `${ORIGIN}/auth/callback?redirect_url=` + encodeURIComponent(`${ORIGIN}/`);
    const out = rewritePreviewLocation(loc, OPTS);
    expect(out.startsWith(`${M}/auth/callback?`)).toBe(true);
    expect(redirectUrlParam(`${ORIGIN}${out}`)).toBe(`${ORIGIN}${M}/?token=${TOKEN}`);
  });
});

describe("rewritePreviewLocation — absolute self-origin redirects", () => {
  it("re-homes an absolute self-origin Location under the mount", () => {
    expect(rewritePreviewLocation(`${ORIGIN}/dashboard`, OPTS)).toBe(
      `${M}/dashboard?token=${TOKEN}`,
    );
  });

  it("re-homes a self-origin root redirect (the bare-\"/\" escape)", () => {
    expect(rewritePreviewLocation(`${ORIGIN}/?token=${TOKEN}`, OPTS)).toBe(
      `${M}/?token=${TOKEN}`,
    );
  });

  it("passes an absolute self-origin Location through without publicOrigin", () => {
    const loc = `${ORIGIN}/dashboard`;
    expect(rewritePreviewLocation(loc, NO_ORIGIN)).toBe(loc);
  });

  it("still passes genuinely external absolute URLs through", () => {
    const loc = "https://accounts.example.com/sign-in?x=1";
    expect(rewritePreviewLocation(loc, OPTS)).toBe(loc);
  });

  it("still passes protocol-relative external URLs through", () => {
    const loc = "//cdn.example.com/lib.js";
    expect(rewritePreviewLocation(loc, OPTS)).toBe(loc);
  });
});

describe("rewritePreviewLocation — pre-existing behavior is unchanged", () => {
  it("re-homes root-relative Locations", () => {
    expect(rewritePreviewLocation("/login", OPTS)).toBe(`${M}/login?token=${TOKEN}`);
    expect(rewritePreviewLocation("/", OPTS)).toBe(`${M}/?token=${TOKEN}`);
  });

  it("re-homes upstream-loopback absolute URLs", () => {
    expect(rewritePreviewLocation(`http://127.0.0.1:${PORT}/x`, OPTS)).toBe(
      `${M}/x?token=${TOKEN}`,
    );
    expect(rewritePreviewLocation(`http://localhost:${PORT}/x`, OPTS)).toBe(
      `${M}/x?token=${TOKEN}`,
    );
  });

  it("keeps already-mounted paths, ensuring the token", () => {
    expect(rewritePreviewLocation(`${M}/page`, OPTS)).toBe(`${M}/page?token=${TOKEN}`);
    expect(rewritePreviewLocation(`${M}/page?token=${TOKEN}`, OPTS)).toBe(
      `${M}/page?token=${TOKEN}`,
    );
  });

  it("adds the token to bare-relative Locations", () => {
    expect(rewritePreviewLocation("login", OPTS)).toBe(`login?token=${TOKEN}`);
  });

  it("returns blank input unchanged", () => {
    expect(rewritePreviewLocation("   ", OPTS)).toBe("   ");
  });
});
