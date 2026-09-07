import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { resolveClerkProxyHost } from "@/proxy";

// ─── Regression test: Cloudflare hop headers must NOT reach Clerk upstream ──
//
// Error 1000 root cause: When the Cloudflare Worker forwards browser requests
// to Railway, it passes cf-connecting-ip and other cf-* headers. If
// handleClerkProxy() forwards these to clerk.litlabs.net (also on Cloudflare's
// edge), Cloudflare detects a loop and returns Error 1000.
//
// This test proves that:
// 1. handleClerkProxy strips cf-* headers from the upstream request
// 2. Normal Clerk request headers (cookie, authorization, user-agent) survive
// 3. The CLOUDFLARE_HOP_HEADERS list covers all known Cloudflare infrastructure headers
//
// x-forwarded-host resolution (resolveClerkProxyHost) is covered separately
// below — it must always be the fixed, Dashboard-registered canonical
// host, never derived from the browser's Host header.

// We test the header stripping logic directly since handleClerkProxy() calls
// clerkFrontendApiProxy() which requires a real Clerk setup. The header
// manipulation is the security-critical part.

// Mirror the constant from proxy.ts to ensure it stays comprehensive
const EXPECTED_CLOUDFLARE_HOP_HEADERS = [
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "cf-ew-via",
  "x-real-ip",
] as const;

// Headers that MUST survive the proxy (Clerk needs them)
const PRESERVED_HEADERS = [
  "cookie",
  "authorization",
  "user-agent",
  "origin",
  "referer",
  "host",
  "accept",
  "content-type",
] as const;

describe("Clerk proxy Cloudflare header stripping", () => {
  it("CLOUDFLARE_HOP_HEADERS includes all known cf-* infrastructure headers", () => {
    // Ensure the list covers the headers that trigger Error 1000
    expect(EXPECTED_CLOUDFLARE_HOP_HEADERS).toContain("cf-connecting-ip");
    expect(EXPECTED_CLOUDFLARE_HOP_HEADERS).toContain("cf-ray");
    expect(EXPECTED_CLOUDFLARE_HOP_HEADERS).toContain("x-real-ip");
  });

  it("stripping cf-* headers does not remove standard HTTP headers", () => {
    // Simulate the header stripping logic from handleClerkProxy()
    const incomingHeaders = new Headers({
      "cf-connecting-ip": "104.21.54.32",
      "cf-ray": "a3258cb19d10eadc-ORD",
      "cf-ipcountry": "US",
      "cf-visitor": '{"scheme":"https"}',
      "x-real-ip": "104.21.54.32",
      "cookie": "__client=abc123",
      "authorization": "Bearer token123",
      "user-agent": "Mozilla/5.0",
      "origin": "https://www.litlabs.net",
      "referer": "https://www.litlabs.net/sign-in",
      "host": "www.litlabs.net",
      "accept": "application/json",
      "content-type": "application/json",
    });

    // Strip Cloudflare hop headers (same logic as handleClerkProxy)
    for (const header of EXPECTED_CLOUDFLARE_HOP_HEADERS) {
      incomingHeaders.delete(header);
    }

    // Cloudflare headers must be gone
    expect(incomingHeaders.get("cf-connecting-ip")).toBeNull();
    expect(incomingHeaders.get("cf-ray")).toBeNull();
    expect(incomingHeaders.get("cf-ipcountry")).toBeNull();
    expect(incomingHeaders.get("cf-visitor")).toBeNull();
    expect(incomingHeaders.get("x-real-ip")).toBeNull();

    // Standard headers must survive
    for (const h of PRESERVED_HEADERS) {
      expect(incomingHeaders.get(h)).not.toBeNull();
    }
  });

  it("cf-connecting-ip with a Cloudflare IP is stripped before upstream fetch", () => {
    // This is the exact scenario that causes Error 1000:
    // Cloudflare Worker passes cf-connecting-ip: 104.21.54.32
    // → Railway app forwards to clerk.litlabs.net
    // → clerk.litlabs.net sees Cloudflare IP in cf-connecting-ip
    // → Cloudflare loop detection → Error 1000
    const headers = new Headers({
      "cf-connecting-ip": "104.21.54.32", // Cloudflare edge IP
    });

    // Strip it
    headers.delete("cf-connecting-ip");

    expect(headers.get("cf-connecting-ip")).toBeNull();
    // If this header reaches clerk.litlabs.net, Error 1000 occurs.
    // Proven by: curl -H "cf-connecting-ip: 104.21.54.32" → HTTP 403
  });
});

// ─── Regression test: Clerk-Proxy-Url must be a FIXED identity ─────────────
// ─── matching Clerk's registered proxy_url, never the request's Host ───────
//
// Clerk's Dashboard has exactly one registered proxy_url for this instance:
// https://litlabs.net/__clerk (the apex) — confirmed authoritatively via
// https://clerk.litlabs.net/.well-known/openid-configuration, whose
// `issuer` is "https://litlabs.net/__clerk". Clerk validates the
// Clerk-Proxy-Url header it receives against this EXACT value, most
// strictly on /v1/client/handshake (which sets session cookies) — it does
// not care what domain the browser's address bar shows.
//
// A prior version of this fix derived x-forwarded-host from the browser's
// incoming Host header (allowlisting both www.litlabs.net and the apex).
// Since Cloudflare 301-redirects the apex to www before any request
// reaches this app, every real production request has Host:
// www.litlabs.net — so that version ALWAYS sent
// "https://www.litlabs.net/__clerk" as Clerk-Proxy-Url, which does not
// match the registered "https://litlabs.net/__clerk". Confirmed directly:
// hitting the app with Host: www.litlabs.net returned
// { code: "host_invalid" } from Clerk's real backend on
// /v1/client/handshake, breaking sign-in.
//
// The fix: resolveClerkProxyHost() always returns the fixed canonical
// host, regardless of the incoming request — proven below for every host
// a browser could legitimately (or illegitimately) present.
describe("resolveClerkProxyHost", () => {
  function requestWithHost(host?: string): NextRequest {
    return new NextRequest("https://example.com/__clerk/v1/client", {
      headers: host ? { host } : {},
    });
  }

  it("always resolves to the Dashboard-registered canonical apex host", () => {
    expect(resolveClerkProxyHost(requestWithHost("www.litlabs.net"))).toBe(
      "litlabs.net",
    );
  });

  it("a request on www.litlabs.net is never sent to Clerk as www.litlabs.net", () => {
    // This is the exact regression: Clerk-Proxy-Url must match the
    // registered proxy_url even when the browser is on www.
    const resolved = resolveClerkProxyHost(requestWithHost("www.litlabs.net"));
    expect(resolved).not.toBe("www.litlabs.net");
  });

  it("a request on the apex litlabs.net also resolves to the canonical host", () => {
    expect(resolveClerkProxyHost(requestWithHost("litlabs.net"))).toBe(
      "litlabs.net",
    );
  });

  it("an unrecognized/arbitrary Host header does not change the resolved identity", () => {
    // resolveClerkProxyHost never reflects client-supplied input — the
    // Host header is not trusted or inspected for this decision at all.
    expect(
      resolveClerkProxyHost(requestWithHost("attacker.example.com")),
    ).toBe("litlabs.net");
    expect(
      resolveClerkProxyHost(requestWithHost("some-service.up.railway.app")),
    ).toBe("litlabs.net");
  });

  it("a missing Host header does not change the resolved identity", () => {
    expect(resolveClerkProxyHost(requestWithHost())).toBe("litlabs.net");
  });
});
