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

function req(path: string, host: string, forwardedHost?: string): NextRequest {
  const headers: Record<string, string> = { host };
  if (forwardedHost) headers["x-forwarded-host"] = forwardedHost;
  return new NextRequest(new URL(path, "https://placeholder.invalid"), {
    headers,
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

  // ─── Robust host handling (PR #637) ───
  // The redirect must handle real-world header variations without
  // creating redirect loops.

  it("strips port suffix from apex host", () => {
    const res = redirectNakedToWww(req("/sign-in", "litlabs.net:443"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe(
      "https://www.litlabs.net/sign-in",
    );
  });

  it("handles mixed-case apex host", () => {
    const res = redirectNakedToWww(req("/", "LITLABS.NET"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe("https://www.litlabs.net/");
  });

  it("handles mixed-case apex host with port", () => {
    const res = redirectNakedToWww(req("/", "LitLabs.Net:8443"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(308);
  });

  it("uses x-forwarded-host fallback when Host is empty", () => {
    const res = redirectNakedToWww(req("/", "", "litlabs.net"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe("https://www.litlabs.net/");
  });

  it("canonical Host takes precedence over x-forwarded-host (no loop)", () => {
    // Critical: if Host is already www but a proxy sets x-forwarded-host
    // to the apex, we must NOT redirect (would loop www -> www).
    expect(
      redirectNakedToWww(req("/sign-in", "www.litlabs.net", "litlabs.net")),
    ).toBeNull();
  });

  it("does not redirect subdomains even with apex forwarded-host", () => {
    expect(
      redirectNakedToWww(req("/", "app.litlabs.net", "litlabs.net")),
    ).toBeNull();
  });
});
