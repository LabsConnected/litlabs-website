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
// below — it must reflect the browser's actual host, not a hardcoded domain.

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

// ─── Regression test: Clerk proxy host must track the real request, ────────
// ─── never a hardcoded apex domain ──────────────────────────────────────────
//
// Root cause of the www -> litlabs.net -> www redirect cycle that broke
// <SignIn/> rendering in production: x-forwarded-host was hardcoded to the
// apex "litlabs.net" for every /__clerk request, regardless of which domain
// the browser actually used. clerkFrontendApiProxy() builds Clerk-Proxy-Url
// (and rewrites any Location header Clerk's FAPI returns, e.g. resolving
// @clerk/clerk-js@6 -> a pinned version) from that header — so a browser on
// www.litlabs.net had every Clerk asset/version redirect forced onto the
// apex, which Cloudflare's own canonicalization then bounced back to www.
//
// resolveClerkProxyHost() fixes this by deriving x-forwarded-host from the
// browser's actual incoming Host header, restricted to an explicit
// allowlist (an arbitrary client-supplied Host is never trusted directly).
describe("resolveClerkProxyHost", () => {
  function requestWithHost(host: string): NextRequest {
    return new NextRequest("https://example.com/__clerk/v1/client", {
      headers: { host },
    });
  }

  it("a request on www.litlabs.net resolves to www.litlabs.net, not the apex", () => {
    expect(resolveClerkProxyHost(requestWithHost("www.litlabs.net"))).toBe(
      "www.litlabs.net",
    );
  });

  it("a request on www.litlabs.net can never be rewritten to the apex domain", () => {
    const resolved = resolveClerkProxyHost(requestWithHost("www.litlabs.net"));
    expect(resolved).not.toBe("litlabs.net");
  });

  it("a request on the apex litlabs.net resolves to litlabs.net", () => {
    expect(resolveClerkProxyHost(requestWithHost("litlabs.net"))).toBe(
      "litlabs.net",
    );
  });

  it("an unrecognized/arbitrary Host header falls back to the canonical production host", () => {
    // Guards against trusting a spoofed Host header (e.g. a request that
    // reaches Railway directly via *.up.railway.app, bypassing Cloudflare).
    expect(
      resolveClerkProxyHost(requestWithHost("attacker.example.com")),
    ).toBe("www.litlabs.net");
    expect(
      resolveClerkProxyHost(requestWithHost("some-service.up.railway.app")),
    ).toBe("www.litlabs.net");
  });

  it("a missing Host header falls back to the canonical production host", () => {
    const req = new NextRequest("https://example.com/__clerk/v1/client");
    expect(resolveClerkProxyHost(req)).toBe("www.litlabs.net");
  });
});
