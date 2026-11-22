import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Regression test: the Studio Browser proxy must stay frameable ──
//
// Root cause (2026-11-22): the Browser panel frames
// /api/studio/browser/proxy, which fetches the target site server-side
// and re-serves it with the target's framing-refusal headers stripped
// and a `Content-Security-Policy: sandbox …` stamped by the route
// (PROXIED_DOCUMENT_CSP in src/lib/studio/browser-proxy.ts).
//
// But next.config.ts applies X-Frame-Options: DENY and the full
// application CSP to `source: "/(.*)"`, and a next.config header wins
// over one set inside a route handler. With no per-path override for
// the proxy, every proxied document was served with OUR OWN DENY —
// the browser refused to frame it and every site showed
// "refused to connect" in the panel, even though the proxy itself
// worked. Verified live: the proxy route's response carried
// `x-frame-options: DENY`.
//
// The fix is an explicit `/api/studio/browser/proxy` rule placed
// AFTER the global rule (later matching rule wins — the same
// mechanism /api/preview and /sites rely on), setting the shared
// PROXIED_DOCUMENT_CSP and X-Frame-Options: SAMEORIGIN.
//
// We assert against the raw next.config.ts source rather than
// importing the config, matching csp-sites-sandbox.test.ts.

describe("Studio Browser proxy (/api/studio/browser/proxy) framing headers", () => {
  const configSource = readFileSync(
    join(__dirname, "../../next.config.ts"),
    "utf-8",
  );

  function globalRuleIndex(): number {
    const i = configSource.indexOf('source: "/(.*)"');
    if (i < 0) throw new Error('no global `source: "/(.*)"` rule found');
    return i;
  }

  function proxyRuleIndex(): number {
    const i = configSource.indexOf('source: "/api/studio/browser/proxy"');
    if (i < 0) {
      throw new Error(
        'no `source: "/api/studio/browser/proxy"` header rule found in ' +
          "next.config.ts — proxied documents would inherit the global " +
          "X-Frame-Options: DENY and the panel could not frame them",
      );
    }
    return i;
  }

  function proxyRuleBlock(): string {
    const start = proxyRuleIndex();
    // The rule object ends at the next rule's opening or the array end;
    // a generous slice covers this one rule's headers.
    return configSource.slice(start, start + 1200);
  }

  it("places the proxy rule after the global rule so it wins", () => {
    expect(proxyRuleIndex()).toBeGreaterThan(globalRuleIndex());
  });

  it("allows same-origin framing instead of DENY", () => {
    const block = proxyRuleBlock();
    expect(block).toContain('"X-Frame-Options"');
    expect(block).toContain('"SAMEORIGIN"');
    expect(block).not.toContain('"DENY"');
  });

  it("serves the shared proxied-document CSP from browser-proxy.ts", () => {
    expect(configSource).toContain(
      'import { PROXIED_DOCUMENT_CSP } from "./src/lib/studio/browser-proxy"',
    );
    expect(proxyRuleBlock()).toContain("PROXIED_DOCUMENT_CSP");
  });
});
