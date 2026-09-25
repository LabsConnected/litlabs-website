import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_ENV_ALLOWLIST,
  buildPreviewEnv,
} from "../preview/PreviewManager";
import {
  isPreviewScopedRedirect,
  stripPreviewAuthHeaders,
} from "../preview/proxy-security";

describe("preview proxy security", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("strips authentication and forwarding headers while preserving safe request headers", () => {
    const headers = new Headers({
      accept: "text/html",
      authorization: "Bearer production-token",
      cookie: "__session=production-cookie",
      "cf-connecting-ip": "203.0.113.10",
      "cf-ray": "production-ray",
      forwarded: "host=terminal.litlabs.net",
      "user-agent": "preview-test",
      "x-forwarded-host": "terminal.litlabs.net",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
      "x-preview-token": "preview-token",
    });

    const result = stripPreviewAuthHeaders(headers, 4123);

    expect(result).toMatchObject({
      accept: "text/html",
      "user-agent": "preview-test",
      host: "127.0.0.1:4123",
    });
    for (const key of [
      "authorization",
      "cookie",
      "cf-connecting-ip",
      "cf-ray",
      "forwarded",
      "x-forwarded-host",
      "x-forwarded-port",
      "x-forwarded-proto",
      "x-preview-token",
    ]) {
      expect(result[key]).toBeUndefined();
    }
  });

  it("allows only redirects within the current workspace preview mount", () => {
    expect(isPreviewScopedRedirect("/preview/ws-123/subpath", "ws-123", "terminal.test")).toBe(true);
    expect(isPreviewScopedRedirect("/preview/ws-123", "ws-123", "terminal.test")).toBe(true);
    expect(isPreviewScopedRedirect("/preview/ws-1234", "ws-123", "terminal.test")).toBe(false);
    expect(isPreviewScopedRedirect("/login", "ws-123", "terminal.test")).toBe(false);
    expect(isPreviewScopedRedirect("https://evil.test/preview/ws-123", "ws-123", "terminal.test")).toBe(false);
    expect(isPreviewScopedRedirect("https://evil.test/preview/ws-123", "ws-123")).toBe(false);
    expect(isPreviewScopedRedirect("https://terminal.test/preview/ws-123", "ws-123", "terminal.test")).toBe(true);
    expect(isPreviewScopedRedirect(null, "ws-123", "terminal.test")).toBe(true);
  });

  it("does not inherit terminal secrets into a preview environment", () => {
    vi.stubEnv("PATH", "safe-path");
    vi.stubEnv("HOME", "safe-home");
    vi.stubEnv("CLERK_SECRET_KEY", "terminal-secret");
    vi.stubEnv("OPENAI_API_KEY", "terminal-api-key");
    vi.stubEnv("TERMINAL_AUTH_SECRET", "terminal-auth-secret");

    const result = buildPreviewEnv({ PROJECT_NAME: "preview-project" });

    expect(result.PATH).toBe("safe-path");
    expect(result.HOME).toBe("safe-home");
    expect(result.PROJECT_NAME).toBe("preview-project");
    expect(result.CLERK_SECRET_KEY).toBeUndefined();
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.TERMINAL_AUTH_SECRET).toBeUndefined();
    expect(Object.keys(result).every((key) => PREVIEW_ENV_ALLOWLIST.includes(key as typeof PREVIEW_ENV_ALLOWLIST[number]) || key === "PROJECT_NAME")).toBe(true);
  });

  it("allows explicit project configuration without inheriting unrelated process variables", () => {
    vi.stubEnv("PATH", "terminal-path");
    vi.stubEnv("DATABASE_URL", "terminal-database-url");

    const result = buildPreviewEnv({ DATABASE_URL: "project-database-url", API_ENDPOINT: "https://project.test" });

    expect(result.DATABASE_URL).toBe("project-database-url");
    expect(result.API_ENDPOINT).toBe("https://project.test");
  });
});
