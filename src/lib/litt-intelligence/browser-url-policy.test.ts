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

  it("blocks IPv4-mapped IPv6 literals that reach blocked IPv4 targets", () => {
    // Regression (security review 2026-11-25): "::ffff:x.x.x.x" bypassed
    // every IPv4 range check — including loopback and the cloud
    // metadata endpoint.
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:a9fe:a9fe]/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, url).toBe(false);
      expect(r.reason).toMatch(/IPv4-mapped|loopback|metadata|link-local/i);
    }
  });

  it("blocks the full fe80::/10 link-local range, not just fe80:", () => {
    for (const url of ["http://[fe80::1]/", "http://[febf::1]/", "http://[febf:ffff::1]/"]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, url).toBe(false);
      expect(r.reason).toMatch(/link-local/i);
    }
  });

  it("blocks deceptive structure even under trusted suffixes", () => {
    // Regression (security review 2026-11-25): .gov/.mil/.edu suffix
    // trust used to short-circuit BEFORE impersonation checks, so a
    // trusted-looking name embedded mid-host was allowed.
    for (const url of [
      "https://google.com.evil.edu/",
      "https://state.gov.evil.edu/",
      "https://google.com.evil.gov/",
      "https://accounts.google.com.harvard.edu.evil.com/",
      "https://wikipedia.org.phish.edu/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
      expect(r.reason).toMatch(/phishing/i);
    }
  });

  it("does not exempt attacker-controlled tenants on shared platforms", () => {
    // Greptile review (PR #1115): github.io/blogspot.com/etc. are
    // trusted for structure but their tenants are NOT brand-owned —
    // squats hosted there must still face the phishing checks.
    for (const url of [
      "https://g00gle.github.io/",
      "https://paypa1.blogspot.com/",
      "https://micr0s0ft.azurewebsites.net/",
      "https://account-suspended.tumblr.com/",
      "https://netfl1x.medium.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
      expect(r.reason).toMatch(/phishing/i);
    }
    // Legitimate shared-platform pages still work.
    for (const url of [
      "https://some-project.github.io/",
      "https://my-blog.blogspot.com/",
      "https://notes.medium.com/",
      "https://shop.myshopify.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
    }
  });

  it("does not block ordinary words one edit from a brand", () => {
    // Greptile review (PR #1115): indel near-misses produced false
    // positives on common words. Substitution/transposition squats
    // still block; 4-char-side indels and plural-"s" forms do not.
    for (const url of [
      "https://team.example.com/",
      "https://metal.com/",
      "https://apples.com/",
      "https://steams.com/",
      "https://metabase.com/",
      "https://steamcommunity.com/",
      "https://dockerhub.com/",
      "https://nvidiageforce.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
    }
    // Genuine squats still block.
    for (const url of [
      "https://gogle.com/", // google minus a letter
      "https://gooogle.com/", // google plus a letter
      "https://amazno.com/", // transposed letters
      "https://githud.com/", // confusable substitution
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
      expect(r.reason).toMatch(/phishing/i);
    }
  });

  it("blocks brands glued to credential words inside one token", () => {
    // Greptile review (PR #1115): "g00glelogin.com" is a single
    // alphanumeric token — token splitting alone misses it.
    for (const url of [
      "https://g00glelogin.com/",
      "https://googlelogin.com/",
      "https://googlelogin2024.com/",
      "https://paypalverify.net/",
      "https://accountgoogle.com/",
      "https://netfl1xofficial.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
      expect(r.reason).toMatch(/phishing/i);
    }
    // Brand + non-credential glue stays allowed.
    for (const url of [
      "https://googlemaps.com/",
      "https://googleblog.com/",
      "https://netflixparty.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
    }
  });

  it("still allows legitimate institutional and suffix-trusted hosts", () => {
    for (const url of [
      "https://www.whitehouse.gov/",
      "https://web.mit.edu/",
      "https://secure-login.mit.edu/", // real university SSO page shape
      "https://accounts.google.com/",
      "https://login.microsoftonline.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
    }
  });

  it("allows regional trusted domains that begin with a shorter trusted name", () => {
    // Greptile review (PR #1115): "google.com.au" legitimately starts
    // with "google.com." — it is itself a verified domain and must not
    // be flagged as impersonation. Same for other enumerated regional
    // variants and their subdomains.
    for (const url of [
      "https://google.com.au/",
      "https://www.google.com.au/",
      "https://amazon.com.br/",
      "https://microsoft.com.au/",
      "https://google.co.uk/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
    }
    // The same prefix on a NON-trusted host is still impersonation.
    for (const url of [
      "https://google.com.evil.com/",
      "https://google.com.io/", // "com.io" is not a public suffix — google.com. is a prefix, not the domain
      "https://amazon.com.phish.net/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
    }
  });

  it("allows legitimate .gov.uk / .edu.au style second-level suffixes", () => {
    // Greptile review (PR #1115): a bare ccTLD after the restricted
    // label is a real public suffix, not mid-host deception.
    for (const url of [
      "https://www.gov.uk/",
      "https://service.gov.uk/",
      "https://unimelb.edu.au/",
      "https://cam.ac.uk/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
    }
    // Restricted TLD followed by anything more than a bare ccTLD is
    // still deceptive — including ccTLD + extra labels.
    for (const url of [
      "https://state.gov.evil.com/",
      "https://service.gov.uk.evil.com/",
      "https://gov.uk.evil.com/",
      "https://unimelb.edu.au.evil.com/",
      "https://mit.edu.phish.io/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} unexpectedly allowed`).toBe(false);
    }
  });

  it("does not mistake DNS names for IPv6 literals", () => {
    // Greptile review (PR #1115): "fe80.example.com" starts with a
    // link-local hextet but is a DNS name — only strings containing
    // ":" are parsed as IPv6.
    for (const url of [
      "https://fe80.example.com/",
      "https://febf.example.com/",
      "https://dead.example.com/",
    ]) {
      const r = checkBrowserUrlPolicy(url);
      expect(r.allowed, `${url} → ${r.reason ?? ""}`).toBe(true);
    }
  });

  it("rejects garbage input", () => {
    const r = checkBrowserUrlPolicy("not a url!!!");
    expect(r.allowed).toBe(false);
  });
});
