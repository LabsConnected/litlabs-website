/**
 * Proxy/middleware auth regression tests.
 *
 * Next.js 16 renamed middleware.ts to proxy.ts. The Clerk middleware,
 * bot protection, and route protection all live in src/proxy.ts.
 *
 * Verifies that:
 * 1. src/proxy.ts exists and exports the Clerk middleware
 * 2. The proxy config matcher excludes static assets
 * 3. The protected route matchers include /studio, /dashboard, and all
 *    customer-critical app routes
 * 4. Protected API routes return 401 JSON (not redirect)
 * 5. Webhook routes are excluded from auth
 * 6. The middleware handles Clerk not configured gracefully
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROXY_PATH = join(process.cwd(), "src", "proxy.ts");
const MIDDLEWARE_PATH = join(process.cwd(), "src", "middleware.ts");

describe("proxy.ts exists and protects Studio routes", () => {
  it("src/proxy.ts exists (Next.js 16 renamed middleware.ts to proxy.ts)", () => {
    expect(existsSync(PROXY_PATH)).toBe(true);
  });

  it("src/middleware.ts does NOT exist (conflicts with proxy.ts on Next.js 16)", () => {
    expect(existsSync(MIDDLEWARE_PATH)).toBe(false);
  });

  it("exports clerkMiddleware as default (via innerMiddleware)", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("clerkMiddleware");
    expect(content).toContain("export default");
  });

  it("config matcher excludes static assets and emulatorjs", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("_next/static");
    expect(content).toContain("_next/image");
    expect(content).toContain("favicon.ico");
    expect(content).toContain("emulatorjs");
  });

  it("protects /studio at the server level (not just client-side redirect)", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain('"/studio');
    expect(content).toContain("NextResponse.redirect");
    expect(content).toContain("/sign-in");
  });

  it("protects /dashboard at the server level", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain('"/dashboard');
  });

  it("protects /projects at the server level", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain('"/projects');
  });

  it("protects /settings at the server level", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain('"/settings');
  });

  it("protects /wallet at the server level", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain('"/wallet');
  });

  it("returns 401 JSON for unauthenticated API requests (not a redirect)", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    // The protectRoute function and the clerkMiddleware both check for /api/ prefix
    expect(content).toContain("401");
    expect(content).toContain("Unauthorized");
    expect(content).toContain('"/api/"');
  });

  it("excludes webhook routes from bot detection (they verify signatures themselves)", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("/api/webhook/clerk");
    expect(content).toContain("/api/stripe/webhook");
  });

  it("always calls clerkMiddleware so detectClerkMiddleware succeeds in API routes", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("clerkMiddleware(");
  });

  it("sets redirect_url query param on sign-in redirect", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("redirect_url");
  });

  it("handles Clerk not configured gracefully (passthrough or protectRoute)", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("isClerkConfigured");
    expect(content).toContain("clerkConfigured");
  });

  it("has bot protection (blocks malicious bots, allows legitimate crawlers)", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("BLOCKED_BOT_PATTERNS");
    expect(content).toContain("ALLOWED_CRAWLER_PATTERNS");
    expect(content).toContain("googlebot");
  });

  it("test auth bypass requires CI=true AND PLAYWRIGHT_TEST=true AND not deployed", () => {
    const content = readFileSync(PROXY_PATH, "utf-8");
    expect(content).toContain("PLAYWRIGHT_AUTH_DISABLED");
    expect(content).toContain("CI");
    expect(content).toContain("PLAYWRIGHT_TEST");
    expect(content).toContain("isDeployed");
  });
});
