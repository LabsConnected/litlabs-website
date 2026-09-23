import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { redirectNakedToWww } from "@/proxy";

// ─── Bare-domain redirect (Larry's site audit 2026-09-23 round 2) ───
// The apex host litlabs.net must 308 to www.litlabs.net, preserving path +
// query, for EVERY path. Cloudflare edge already does this; proxy.ts is
// defense in depth. Every other host must pass through untouched (null).
//
// NOTE: test-constructed NextRequests do not derive the Host header from
// the URL, so the header is set explicitly — matching what the function
// reads in production.

function req(path: string, host: string): NextRequest {
  return new NextRequest(new URL(path, "https://placeholder.invalid"), {
    headers: { host },
  });
}

describe("redirectNakedToWww", () => {
  it("308-redirects the apex to www, preserving path and query", () => {
    const res = redirectNakedToWww(req("/pricing?plan=pro", "litlabs.net"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe(
      "https://www.litlabs.net/pricing?plan=pro",
    );
  });

  it("redirects the apex root", () => {
    const res = redirectNakedToWww(req("/", "litlabs.net"));
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe("https://www.litlabs.net/");
  });

  it("still covers the auth pages it historically handled", () => {
    const res = redirectNakedToWww(
      req("/sign-in?redirect_url=%2Fstudio", "litlabs.net"),
    );
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe(
      "https://www.litlabs.net/sign-in?redirect_url=%2Fstudio",
    );
  });

  it("leaves www.litlabs.net alone", () => {
    expect(redirectNakedToWww(req("/pricing", "www.litlabs.net"))).toBeNull();
  });

  it("leaves app., terminal., localhost, and Railway domains alone", () => {
    for (const host of [
      "app.litlabs.net",
      "terminal.litlabs.net",
      "localhost:3000",
      "litlabs-website.up.railway.app",
    ]) {
      expect(redirectNakedToWww(req("/api/health", host)), host).toBeNull();
    }
  });

  it("does not touch lookalike hosts", () => {
    expect(
      redirectNakedToWww(req("/", "litlabs.net.evil.com")),
    ).toBeNull();
    expect(redirectNakedToWww(req("/", "wwwlitlabs.net"))).toBeNull();
  });
});
