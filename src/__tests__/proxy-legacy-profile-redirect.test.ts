import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { redirectLegacyProfileToU } from "@/proxy";

// ─── Social-mission Phase 2: legacy /profile/<username> → /u/<username> ───
// The redirect must run before Clerk auth in the proxy so signed-out visitors
// following old profile links land on the public profile instead of being
// bounced to sign-in (/profile/* is a protected route; /u/* is public).

function req(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://www.litlabs.net"));
}

describe("redirectLegacyProfileToU", () => {
  it("308-redirects /profile/<username> to /u/<username>", () => {
    const res = redirectLegacyProfileToU(req("/profile/mallory"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe(
      "https://www.litlabs.net/u/mallory",
    );
  });

  it("preserves the query string", () => {
    const res = redirectLegacyProfileToU(req("/profile/mallory?tab=about"));
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe(
      "https://www.litlabs.net/u/mallory?tab=about",
    );
  });

  it("handles a trailing slash without duplicating it", () => {
    const res = redirectLegacyProfileToU(req("/profile/mallory/"));
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe(
      "https://www.litlabs.net/u/mallory",
    );
  });

  it("URL-encodes special characters in the handle", () => {
    const res = redirectLegacyProfileToU(req("/profile/foo%20bar"));
    expect(res!.status).toBe(308);
    expect(res!.headers.get("location")).toBe(
      "https://www.litlabs.net/u/foo%20bar",
    );
  });

  it("leaves bare /profile alone (the Account menu link)", () => {
    expect(redirectLegacyProfileToU(req("/profile"))).toBeNull();
    expect(redirectLegacyProfileToU(req("/profile/"))).toBeNull();
  });

  it("leaves deeper paths alone", () => {
    expect(redirectLegacyProfileToU(req("/profile/mallory/posts"))).toBeNull();
  });

  it("ignores unrelated routes", () => {
    expect(redirectLegacyProfileToU(req("/u/mallory"))).toBeNull();
    expect(redirectLegacyProfileToU(req("/discover"))).toBeNull();
    expect(redirectLegacyProfileToU(req("/"))).toBeNull();
    expect(redirectLegacyProfileToU(req("/api/posts"))).toBeNull();
  });
});
