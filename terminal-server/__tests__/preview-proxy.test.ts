/**
 * Regression tests for the preview proxy servability guard (2026-09-18).
 *
 * Production defect: Studio showed "Preview ready" while the iframe
 * displayed the backend's white "Cannot GET /". The public preview proxy
 * (/preview/:workspaceId) only checked the IN-MEMORY runtime status
 * ("ready" + port) and forwarded whatever the port returned — including
 * an Express 404 from a stale/wrong process on the port.
 *
 * The fix: at proxy time, a 404 on the entry path (/) flips the runtime
 * to failed (preview_root_route_missing) and serves an honest error page
 * instead of the raw backend 404. A dead backend (connection refused)
 * flips to preview_dev_server_failed with an honest page instead of raw
 * JSON next to a green badge.
 *
 * These tests cover:
 *   - isPreviewEntryPath: only the entry document counts — asset 404s
 *     (/_next/static/..., /favicon.ico) must never fail the runtime
 *   - decideProxiedEntryResponse: entry 404 -> guard; everything else -> proxy
 *   - mark functions: no-op (no throw) on unknown workspaces
 *   - buildPreviewErrorPage: honest copy, never the raw "Cannot GET /",
 *     HTML-escapes untrusted fields, notifies the parent window
 */

import { describe, it, expect } from "vitest";

import {
  isPreviewEntryPath,
  decideProxiedEntryResponse,
  markPreviewRootRouteMissing,
  markPreviewBackendUnreachable,
  buildPreviewErrorPage,
} from "../preview/PreviewManager";

describe("preview proxy guard — isPreviewEntryPath", () => {
  it("treats / and the empty path as the entry path", () => {
    expect(isPreviewEntryPath("/")).toBe(true);
    expect(isPreviewEntryPath("")).toBe(true);
  });

  it("ignores query strings and fragments when classifying", () => {
    expect(isPreviewEntryPath("/?token=abc123")).toBe(true);
    expect(isPreviewEntryPath("?token=abc123")).toBe(true);
    expect(isPreviewEntryPath("/#top")).toBe(true);
  });

  it("does NOT treat asset paths as the entry path", () => {
    expect(isPreviewEntryPath("/_next/static/chunks/app.js")).toBe(false);
    expect(isPreviewEntryPath("/favicon.ico")).toBe(false);
    expect(isPreviewEntryPath("/api/health")).toBe(false);
    // A Next.js app 404s /index.html normally — that must not fail preview.
    expect(isPreviewEntryPath("/index.html")).toBe(false);
  });
});

describe("preview proxy guard — decideProxiedEntryResponse", () => {
  it("flags the production defect: entry path + backend 404", () => {
    expect(decideProxiedEntryResponse("/", 404)).toBe("entry_route_missing");
    expect(decideProxiedEntryResponse("", 404)).toBe("entry_route_missing");
    expect(decideProxiedEntryResponse("/?token=abc", 404)).toBe("entry_route_missing");
  });

  it("proxies asset 404s — a missing chunk must not kill the preview", () => {
    expect(decideProxiedEntryResponse("/_next/static/chunks/app.js", 404)).toBe("proxy");
    expect(decideProxiedEntryResponse("/favicon.ico", 404)).toBe("proxy");
  });

  it("proxies non-404 entry responses untouched", () => {
    expect(decideProxiedEntryResponse("/", 200)).toBe("proxy");
    expect(decideProxiedEntryResponse("/", 500)).toBe("proxy");
    expect(decideProxiedEntryResponse("/", 302)).toBe("proxy");
  });
});

describe("preview proxy guard — mark functions are safe on unknown workspaces", () => {
  it("markPreviewRootRouteMissing returns false without throwing", () => {
    expect(markPreviewRootRouteMissing("ws_does_not_exist")).toBe(false);
  });

  it("markPreviewBackendUnreachable returns false without throwing", () => {
    expect(markPreviewBackendUnreachable("ws_does_not_exist")).toBe(false);
  });
});

describe("preview proxy guard — buildPreviewErrorPage", () => {
  const page = buildPreviewErrorPage({
    heading: "Preview isn't serving the app",
    message: "The entry route returned 404.",
    command: "pnpm exec next dev --port 4100 --hostname 0.0.0.0",
    framework: "nextjs",
    errorCode: "preview_root_route_missing",
    workspaceId: "ws_1",
  });

  it("is honest about what happened", () => {
    expect(page).toContain("Preview isn't serving the app");
    expect(page).toContain("The entry route returned 404.");
    expect(page).toContain("preview_root_route_missing");
    expect(page).toContain("pnpm exec next dev --port 4100 --hostname 0.0.0.0");
  });

  it("never leaks the raw backend 404 into the page", () => {
    expect(page).not.toContain("Cannot GET /");
  });

  it("notifies the Studio parent window so the badge flips", () => {
    expect(page).toContain("litt-preview");
    expect(page).toContain("preview-entry-missing");
    expect(page).toContain("ws_1");
  });

  it("HTML-escapes untrusted fields", () => {
    const evil = buildPreviewErrorPage({
      heading: "x",
      message: "y",
      command: '"><script>alert(1)</script>',
      workspaceId: "ws_1",
    });
    expect(evil).not.toContain('"><script>alert(1)</script>');
    expect(evil).toContain("&quot;&gt;&lt;script&gt;");
  });
});
