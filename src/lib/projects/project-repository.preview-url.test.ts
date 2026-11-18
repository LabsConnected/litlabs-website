import { describe, it, expect, vi, afterEach } from "vitest";
import { refreshStoredPreviewUrl } from "@/lib/projects/project-repository";
import type { CanonicalProject } from "@/lib/projects/types";

/**
 * Phase 2 build-list §3.3 pins — stored preview URLs are not durable.
 *
 * A scoped preview URL carries a signed token with a five-minute
 * life, so reads of a ready project must re-mint rather than hand
 * back the stored (likely expired) URL. Everything else — non-ready
 * rows, non-proxy URLs, missing workspace/URL — passes through
 * untouched (same object identity).
 */

function project(overrides: Record<string, unknown> = {}): CanonicalProject {
  return {
    id: "proj-1",
    userId: "user-1",
    runtimeStatus: "ready",
    workspaceId: "ws-1",
    previewUrl: "http://terminal.internal:4001/preview/ws-1?token=stale-token",
    ...overrides,
  } as unknown as CanonicalProject;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refreshStoredPreviewUrl", () => {
  it("re-mints a fresh scoped token for a ready project's stored proxy URL", () => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", "s".repeat(40));
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "http://terminal.internal:4001");
    vi.stubEnv("PREVIEW_ACCESS_TOKEN", "global-token-must-not-leak");
    const result = refreshStoredPreviewUrl(project());
    expect(result.previewUrl).toContain("/preview/ws-1?token=");
    expect(result.previewUrl).not.toContain("stale-token");
    expect(result.previewUrl).not.toContain("global-token-must-not-leak");
    const token = new URL(result.previewUrl ?? "").searchParams.get("token") ?? "";
    expect(token.split(".")).toHaveLength(2);
  });

  it("passes a non-ready project through untouched", () => {
    const input = project({ runtimeStatus: "stopped" });
    expect(refreshStoredPreviewUrl(input)).toBe(input);
  });

  it("passes a ready project with no stored URL through untouched", () => {
    const input = project({ previewUrl: null });
    expect(refreshStoredPreviewUrl(input)).toBe(input);
  });

  it("passes a ready project with no workspace through untouched", () => {
    const input = project({ workspaceId: null });
    expect(refreshStoredPreviewUrl(input)).toBe(input);
  });

  it("does not touch non-proxy URLs (static serve paths)", () => {
    const input = project({ previewUrl: "/api/preview/proj-1/index.html" });
    expect(refreshStoredPreviewUrl(input)).toBe(input);
  });

  it("does not touch unparseable stored values", () => {
    const input = project({ previewUrl: "not a url" });
    expect(refreshStoredPreviewUrl(input)).toBe(input);
  });
});
