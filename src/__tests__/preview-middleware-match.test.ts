// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: vi.fn(() => vi.fn()), createRouteMatcher: vi.fn(() => vi.fn()) }));
vi.mock("@clerk/backend/proxy", () => ({ clerkFrontendApiProxy: vi.fn() }));
import { config } from "@/proxy";

describe("authenticated preview asset middleware", () => {
  it.each(["", "style.css", "assets/app.js", "logo.svg", "fonts/site.woff2"])("matches preview %s", (asset) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `https://www.litlabs.net/api/preview/project-1/${asset}` })).toBe(true);
  });
  it.each(["/styles/site.css", "/logo.svg", "/_next/static/chunk.js", "/emulatorjs/data/game.data"])("keeps public static exclusions for %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `https://www.litlabs.net${path}` })).toBe(false);
  });
});
