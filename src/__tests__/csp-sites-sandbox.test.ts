import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Regression test: deployed user output must keep its sandbox CSP ──
//
// Root cause (2026-09-13): src/app/sites/[deploymentId]/[[...path]]/route.ts
// serves USER-AUTHORED HTML from LiTT's own origin and sets
//
//   Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups
//
// on its own response. Its header comment names that directive as the control
// that "makes same-origin hosting safe enough for V1" — without
// `allow-same-origin` the document sits in an opaque origin and cannot read
// document.cookie/localStorage or make credentialed same-origin requests to
// /api/*.
//
// But next.config.ts applies the full application CSP to `source: "/(.*)"`,
// and a next.config header wins over one set inside a route handler. The
// sandbox directive was therefore stripped in production. Verified against a
// real deployed project (/sites/6a1c1a12-…): exactly one
// Content-Security-Policy header was served and it contained no `sandbox`
// directive — instead it carried the app policy, including
// `script-src 'unsafe-inline' 'unsafe-eval'` and `connect-src 'self'`, which
// would let a generated page issue credentialed calls to the app's own API
// as whoever visited it.
//
// The fix is an explicit `/sites/:path*` rule placed AFTER the global rule,
// so the later matching rule wins for the duplicated header key (the same
// mechanism /arcade-runtime/:path* already relies on).
//
// We assert against the raw next.config.ts source rather than importing the
// config, which pulls in @sentry/nextjs and Next.js build-time APIs that are
// not meant to run under vitest — matching csp-form-action.test.ts.

describe("deployed user output (/sites) CSP sandbox", () => {
  const configSource = readFileSync(
    join(__dirname, "../../next.config.ts"),
    "utf-8",
  );

  function sitesRuleIndex(): number {
    const i = configSource.indexOf('source: "/sites/:path*"');
    if (i < 0) {
      throw new Error(
        'no `source: "/sites/:path*"` header rule found in next.config.ts — ' +
          "deployed user HTML would inherit the application CSP",
      );
    }
    return i;
  }

  it("defines a header rule for /sites/:path*", () => {
    expect(() => sitesRuleIndex()).not.toThrow();
  });

  it("sandboxes deployed output without allow-same-origin", () => {
    const rule = configSource.slice(sitesRuleIndex(), sitesRuleIndex() + 600);
    const csp = rule.match(/"(sandbox[^"]*)"/);
    expect(csp, "/sites rule must set a `sandbox` CSP").not.toBeNull();

    const value = csp![1];
    expect(value).toContain("sandbox");
    expect(value).toContain("allow-scripts");
    // The whole point: an opaque origin. allow-same-origin would defeat it by
    // restoring access to cookies, localStorage and credentialed /api calls.
    expect(value).not.toContain("allow-same-origin");
  });

  it("keeps nosniff on deployed output", () => {
    const rule = configSource.slice(sitesRuleIndex() - 200, sitesRuleIndex() + 600);
    expect(rule).toContain("X-Content-Type-Options");
  });

  it("orders the /sites rule after the global rule so it wins", () => {
    const globalRule = configSource.indexOf('source: "/(.*)"');
    expect(globalRule).toBeGreaterThan(-1);
    // For a duplicated header key, Next.js applies the later matching rule.
    expect(sitesRuleIndex()).toBeGreaterThan(globalRule);
  });

  it("still sandboxes in the route handler itself, as defence in depth", () => {
    const routeSource = readFileSync(
      join(__dirname, "../app/sites/[deploymentId]/[[...path]]/route.ts"),
      "utf-8",
    );
    const match = routeSource.match(/"(sandbox[^"]*)"/);
    expect(match, "route handler must also set a sandbox CSP").not.toBeNull();
    expect(match![1]).not.toContain("allow-same-origin");
  });
});
