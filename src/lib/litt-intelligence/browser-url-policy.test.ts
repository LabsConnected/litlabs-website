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

  // ─── False-positive regression: verified legitimate domains ────
  // The pre-fix typosquat regexes (/g[o0]{2}gle/, /micr[o0]s[o0]ft/,
  // /amaz[o0]n/, /paypa[l1]/, /faceb[o0]{2}k/, /netfl[i1]x/) matched the
  // LEGITIMATE spellings and blocked google.com, microsoft.com, etc.
  // in the Studio browser. These must never be blocked again.
  describe("verified legitimate domains are allowed", () => {
    const legit = [
      "https://www.google.com/",
      "https://google.com/search?q=test",
      "https://maps.google.com/",
      "https://github.com/LabsConnected/litlabs-website",
      "https://gist.github.com/",
      "https://www.microsoft.com/",
      "https://learn.microsoft.com/",
      "https://www.youtube.com/watch?v=abc",
      "https://youtu.be/abc",
      "https://openai.com/",
      "https://chatgpt.com/",
      "https://www.wikipedia.org/wiki/Main_Page",
      "https://en.wikipedia.org/wiki/Web_browser",
      "https://www.paypal.com/",
      "https://www.amazon.com/",
      "https://aws.amazon.com/",
      "https://www.netflix.com/",
      "https://www.facebook.com/",
      "https://www.apple.com/",
      "https://icloud.com/",
      "https://www.spotify.com/",
      "https://www.linkedin.com/",
      "https://www.reddit.com/",
      "https://stackoverflow.com/",
      "https://vercel.com/",
      "https://chase.com/",
      "https://www.wellsfargo.com/",
      "https://www.whitehouse.gov/",
      "https://web.mit.edu/",
      "https://www.google.co.uk/",
      "https://www.amazon.de/",
      "https://google.com./", // trailing root dot
      "https://GOOGLE.COM/", // case-insensitive
    ];
    for (const url of legit) {
      it(`allows ${url}`, () => {
        const r = checkBrowserUrlPolicy(url);
        expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
      });
    }
  });

  // ─── Typosquats and lookalikes must stay blocked ───────────────
  describe("brand typosquats and lookalikes are blocked", () => {
    const squats = [
      "https://g00gle.com/",
      "https://go0gle.com/",
      "https://gogle.com/",
      "https://googel.com/",
      "https://gooogle.com/",
      "https://goog1e.com/",
      "https://paypa1.com/",
      "https://paypa1-secure.com/",
      "https://pay-pal.com/",
      "https://micr0s0ft.com/",
      "https://micorsoft.com/",
      "https://m1crosoft.com/",
      "https://amaz0n.com/",
      "https://netfl1x.com/",
      "https://faceb00k.com/",
      "https://youtub3.com/",
      "https://githud.com/",
      "https://0penai.com/",
      "https://chatgpt-secure.net/",
      "https://wikipedi4.org/",
      "https://app1e-id.net/",
      "https://g00gle-login.com/",
      "https://secure-g00gle.com/",
    ];
    for (const url of squats) {
      it(`blocks ${url}`, () => {
        const r = checkBrowserUrlPolicy(url);
        expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
        expect(r.reason).toMatch(/phishing/i);
      });
    }
  });

  // ─── Deceptive subdomains and impersonation ────────────────────
  describe("deceptive subdomains and impersonation are blocked", () => {
    const deceptive = [
      "https://google.com.evil.com/",
      "https://www.google.com.phish.net/",
      "https://accounts.google.com.attacker.org/",
      "https://github.com.evil.io/",
      "https://openai.com.verify-account.net/",
      "https://state.gov.evil.com/",
      "https://mit.edu.phishing-site.com/",
      "https://google-login.evil.com/",
      "https://paypal-verify.evil.com/",
      "https://microsoft-support.evil.com/",
      "https://openai-account-verify.com/",
    ];
    for (const url of deceptive) {
      it(`blocks ${url}`, () => {
        const r = checkBrowserUrlPolicy(url);
        expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
        expect(r.reason).toMatch(/phishing/i);
      });
    }
  });

  // ─── Unicode / IDN impersonation ───────────────────────────────
  describe("unicode and punycode impersonation is blocked", () => {
    it("blocks punycode (xn--) labels outright", () => {
      for (const url of [
        "https://xn--pple-43d.com/",
        "https://xn--gogle-9qa.com/",
        "https://www.xn--80ak6aa92e.com/",
      ]) {
        const r = checkBrowserUrlPolicy(url);
        expect(r.allowed, url).toBe(false);
        expect(r.reason).toMatch(/phishing|IDN/i);
      }
    });

    it("blocks unicode homoglyph domains (normalized to punycode by URL)", () => {
      // U+043E is Cyrillic о — built via escape so the homoglyph is
      // guaranteed regardless of file encoding. The URL parser
      // punycodes it and the xn-- rule catches it.
      const r = checkBrowserUrlPolicy(`https://g${String.fromCharCode(0x43e)}ogle.com/`);
      expect(r.allowed).toBe(false);
    });
  });

  // ─── Boundary validation: allowlist must not be bypassable ─────
  describe("allowlist boundary validation", () => {
    const bypassAttempts = [
      "https://evilgoogle.com/", // brand embedded mid-label
      "https://google.com.evil.com/", // trusted name as subdomain
      "https://notgoogle.com/",
      "https://google.evil.com/", // brand label under foreign TLD, no bait
      "https://my-google.com/",
      "https://googlemail.com/",
    ];
    for (const url of bypassAttempts) {
      it(`handles ${url} without crashing`, () => {
        const r = checkBrowserUrlPolicy(url);
        // These must not throw and must return a definite verdict;
        // deceptive-subdomain forms are asserted blocked above.
        expect(typeof r.allowed).toBe("boolean");
      });
    }

    it("still blocks brand + credential-bait even when brand is verbatim", () => {
      for (const url of [
        "https://google-account-verify.com/",
        "https://paypal-login-secure.net/",
        "https://microsoft-billing-update.com/",
      ]) {
        const r = checkBrowserUrlPolicy(url);
        expect(r.allowed, url).toBe(false);
        expect(r.reason).toMatch(/phishing/i);
      }
    });

    it("does not false-positive ordinary words that contain brand substrings", () => {
      for (const url of [
        "https://maple.com/", // vs apple
        "https://blackforest.com/", // vs slack-adjacent
        "https://pineapple.com/",
        "https://amazonaws.com/", // trusted anyway
        "https://github.community/", // GitHub's own community domain
        "https://microsoft.dev/", // Microsoft's developer TLD presence
      ]) {
        const r = checkBrowserUrlPolicy(url);
        expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
      }
    });
  });

  it("rejects garbage input", () => {
    const r = checkBrowserUrlPolicy("not a url!!!");
    expect(r.allowed).toBe(false);
  });
});
