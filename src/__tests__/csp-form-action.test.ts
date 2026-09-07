import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Regression test: CSP form-action must allow the LiTT CLI's OAuth ──
// loopback callback redirect
//
// Root cause (2026-09-07): Clerk's /v1/me/oauth/consent endpoint responds
// to the custom consent form's POST with a 303 redirecting the browser to
// the CLI's ephemeral http://127.0.0.1:{port}/callback (RFC 8252 SS7.3).
// Chrome/Brave enforce the form-action CSP directive against the FINAL
// redirect target, not just the form's immediate POST action — so without
// a loopback entry, the browser silently drops the redirect and the CLI's
// callback server never receives the authorization code. The user sees no
// error at all: the consent page just does nothing after "Allow" is tapped.
//
// We assert against the raw next.config.ts source (rather than importing
// the config, which pulls in @sentry/nextjs and Next.js build-time APIs
// not meant to run under vitest) since the header value is a static string.

describe("CSP form-action directive", () => {
  const configSource = readFileSync(
    join(__dirname, "../../next.config.ts"),
    "utf-8",
  );

  function extractFormAction(): string {
    const match = configSource.match(/"form-action ([^"]*)"/);
    if (!match) throw new Error("form-action directive not found in next.config.ts");
    return match[1];
  }

  it("allows the CLI's loopback OAuth callback on any ephemeral port", () => {
    const formAction = extractFormAction();
    expect(formAction).toContain("http://127.0.0.1:*");
  });

  it("still restricts to 'self' and the known Clerk hosts", () => {
    const formAction = extractFormAction();
    expect(formAction).toContain("'self'");
    expect(formAction).toContain("https://clerk.litlabs.net");
  });
});
