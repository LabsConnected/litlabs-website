/**
 * Agent Browser Phase 2 — URL policy regression tests (§5.3).
 *
 * Pure unit tests over checkBrowserUrlPolicy / normalizeBrowserUrl:
 * loopback, link-local, metadata endpoints, non-http(s) schemes, and
 * credential-phishing hostname patterns must be blocked; ordinary
 * https URLs must pass.
 */
import { describe, it, expect } from "vitest";
import { checkBrowserUrlPolicy, normalizeBrowserUrl } from "./browser-url-policy";

describe("normalizeBrowserUrl", () => {
  it("adds https:// to bare domains", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBrowserUrl("chrome://settings")).toBeNull();
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("data:text/html,hi")).toBeNull();
    expect(normalizeBrowserUrl("ftp://example.com")).toBeNull();
  });
});

describe("checkBrowserUrlPolicy", () => {
  it("allows ordinary https URLs", () => {
    expect(checkBrowserUrlPolicy("https://example.com/page?q=1").allowed).toBe(true);
    expect(checkBrowserUrlPolicy("example.com").allowed).toBe(true);
  });

  it("blocks loopback addresses", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://127.0.0.1:3000/admin",
      "http://127.1.2.3/",
      "http://localhost/",
      "http://localhost:8080/",
      "http://[::1]/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, url).toBe(false);
      expect(r.reason).toMatch(/loopback|localhost/i);
    }
  });

  it("blocks the unspecified address", () => {
    const r = checkBrowserUrlPolicy("http://0.0.0.0/");
    expect(r.allowed).toBe(false);
  });

  it("blocks link-local addresses", () => {
    const r = checkBrowserUrlPolicy("http://169.254.10.20/");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/link-local/i);
  });

  it("blocks the cloud metadata IP explicitly", () => {
    const r = checkBrowserUrlPolicy("http://169.254.169.254/latest/meta-data/");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/metadata/i);
    expect(r.host).toBe("169.254.169.254");
  });

  it("blocks cloud metadata hostnames", () => {
    for (const host of ["metadata.google.internal", "instance-data"]) {
      const r = checkBrowserUrlPolicy(`http://${host}/`);
      expect(r.allowed, host).toBe(false);
      expect(r.reason).toMatch(/metadata/i);
    }
  });

  it("blocks non-http(s) schemes", () => {
    for (const url of ["file:///etc/passwd", "chrome://settings", "javascript:alert(1)"]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, url).toBe(false);
    }
  });

  it("blocks credential-phishing hosts", () => {
    for (const url of [
      "https://paypa1-secure-login.com/",
      "https://apple-id-verify.net/",
      "https://micorsoft-login.com/",
      "https://account-suspended-alert.com/",
      "https://xn--pple-43d.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, url).toBe(false);
      expect(r.reason).toMatch(/phishing/i);
    }
  });

  it("does not block legitimate lookalike-adjacent hosts used in tests", () => {
    // example.com is the canonical safe host; policy must not false-positive.
    expect(checkBrowserUrlPolicy("https://example.com/").allowed).toBe(true);
  });

  it("rejects garbage input", () => {
    const r = checkBrowserUrlPolicy("not a url!!!");
    expect(r.allowed).toBe(false);
  });
});
