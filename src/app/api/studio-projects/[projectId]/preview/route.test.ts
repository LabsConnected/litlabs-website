import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  DELETE,
  GET,
  POST,
} from "@/app/api/studio-projects/[projectId]/preview/route";

/**
 * P0 — AI Build → Static Preview: studio-projects preview route-level tests.
 *
 * Proves the static-project server-side guards:
 *  1. POST rejects static projects at the API boundary (no dev server startup).
 *  2. GET returns ready + a static preview URL for static projects WITHOUT
 *     consulting the dev-server status path (getPreviewStatusInternal).
 *  3. GET returns not_started when index.html is missing from the workspace.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
  updateProjectRuntime: vi.fn(),
}));

vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
  provisionWorkspaceForProject: vi.fn(),
  reprepareWorkspace: vi.fn(),
}));

vi.mock("@/lib/terminal-v1/secret-broker", () => ({
  SecretBroker: vi.fn(),
}));

vi.mock("@/lib/preview-clerk-env", () => ({
  extractClerkEnvFromSecrets: vi.fn(() => ({})),
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "test-token", expiresAt: Date.now() + 60000 })),
}));

vi.mock("@/lib/projects/preview-token", () => ({
  createPreviewToken: vi.fn(() => ({ token: "preview-token-1", expiresAt: Date.now() + 60000 })),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));

vi.mock("@/lib/terminal-internal-client", () => ({
  startPreviewInternal: vi.fn(),
  restartPreviewInternal: vi.fn(),
  getPreviewStatusInternal: vi.fn(),
  stopPreviewInternal: vi.fn(),
  buildPreviewProxyUrl: vi.fn((workspaceId: string) => `https://proxy.test/${workspaceId}`),
  // Phase 2 §3.2: the route now consults sandbox availability for the
  // deterministic refusal derivation. Default: not available (fail
  // closed), which preserves every pre-Phase-2 expectation below.
  getSandboxAvailability: vi.fn(async () => ({
    provider: null,
    routingEnabled: false,
    verified: false,
    allowed: false,
    reason: "availability-unavailable",
  })),
  isSandboxExecutionAvailable: vi.fn(async () => false),
}));

import { auth } from "@/lib/auth";
import { getProject, updateProjectRuntime } from "@/lib/projects/project-repository";
import {
  startPreviewInternal,
  restartPreviewInternal,
  getPreviewStatusInternal,
  stopPreviewInternal,
  isSandboxExecutionAvailable,
} from "@/lib/terminal-internal-client";
import { ensureWorkspaceAlive, provisionWorkspaceForProject, reprepareWorkspace } from "@/lib/studio/workspace-recovery";
import { createPreviewToken } from "@/lib/projects/preview-token";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const updateProjectRuntimeMock = vi.mocked(updateProjectRuntime);
const getPreviewStatusMock = vi.mocked(getPreviewStatusInternal);
const startPreviewMock = vi.mocked(startPreviewInternal);
const restartPreviewMock = vi.mocked(restartPreviewInternal);
const stopPreviewMock = vi.mocked(stopPreviewInternal);
const provisionMock = vi.mocked(provisionWorkspaceForProject);
const ensureAliveMock = vi.mocked(ensureWorkspaceAlive);
const reprepareMock = vi.mocked(reprepareWorkspace);
const createPreviewTokenMock = vi.mocked(createPreviewToken);
const sandboxAvailableMock = vi.mocked(isSandboxExecutionAvailable);

const staticProject = {
  id: "proj-1",
  userId: "user-1",
  workspaceId: "ws-1",
  framework: "static",
};

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe("studio-projects preview route — static guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ ...staticProject } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST returns 400 for framework: static (server-side guard)", async () => {
    const res = await POST(
      new Request("https://x.test/api/studio-projects/proj-1/preview", { method: "POST" }) as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Static projects");
    // The dev-server machinery must never engage for static projects.
    expect(provisionMock).not.toHaveBeenCalled();
    expect(startPreviewMock).not.toHaveBeenCalled();
  });

  it("GET returns ready + static URL with a project-scoped preview token", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _opts?: RequestInit) =>
      new Response(JSON.stringify({ content: "<html></html>" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // The real preview-token module throws when TERMINAL_AUTH_SECRET is unset,
    // so this test proves the static path still reaches ready when the terminal
    // returns a real index.html blob. prove that readiness no longer depends on
    // the dev-server status path even when the token-bearing previewUrl would
    // only have been set by a prior regression that consulted getPreviewStatusInternal.
    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("ready");
    expect(body.previewUrl).toBe("/api/preview/proj-1/t/preview-token-1/index.html");
    expect(body.previewToken).toBe("preview-token-1");
    expect(body.previewTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(body.previewTokenExpiresAt).toBeLessThanOrEqual(Date.now() + 60000);
    expect(body.framework).toBe("static");
    // The index.html existence check fires exactly once; the dev-server
    // status path is never consulted for static projects.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/ws-files/read");
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
    expect(createPreviewTokenMock).toHaveBeenCalledTimes(1);
    expect(createPreviewTokenMock).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ projectId: "proj-1", workspaceId: "ws-1", assets: ["index.html"] }),
    );
  });

  it("GET mints the preview token against the real asset closure, not a stub manifest", async () => {
    // Regression: the status endpoint previously minted the token from a
    // placeholder "<html></html>" + null reader, so the signed manifest
    // contained only index.html — every script/asset subrequest from the
    // opaque-origin iframe then 403'd. The token must cover the same
    // closure the serving route computes, including renderable assets.
    const files: Record<string, string> = {
      "index.html": '<html><head><script src="/app.js"></script></head><body><img src="hero.png"></body></html>',
      "app.js": "console.log(1);",
      "hero.png": "binary",
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body ?? "{}")) as { path?: string };
      const content = files[body.path ?? ""];
      return content === undefined
        ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
        : new Response(JSON.stringify({ content }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("ready");
    expect(createPreviewTokenMock).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        projectId: "proj-1",
        workspaceId: "ws-1",
        assets: expect.arrayContaining(["index.html", "app.js", "hero.png"]),
      }),
    );
  });

  it("GET returns failed when the asset manifest cannot be verified", async () => {
    const files: Record<string, string> = {
      "index.html": '<html><head><script type="module" src="ghost.js"></script></head><body></body></html>',
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body ?? "{}")) as { path?: string };
      const content = files[body.path ?? ""];
      return content === undefined
        ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
        : new Response(JSON.stringify({ content }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("failed");
    expect(body.previewUrl).toBeNull();
    expect(body.runtimeError).toContain("manifest");
    // No capability token may be minted against an unverifiable closure.
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
  });

  it("GET returns unreachable when the terminal is unreachable", async () => {
    // A failed runtime CHECK (terminal threw / timed out / not configured)
    // says nothing about whether the preview was ever started — the static
    // branch must report "unreachable", mirroring the dev-server branch,
    // never not_started. Only an authoritative terminal 404 may mean
    // not_started (see the index.html-missing test below).
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("TerminalNotConfiguredError");
    }));

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("unreachable");
    expect(body.previewUrl).toBeNull();
    expect(body.framework).toBe("static");
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
    // No preview token may be minted off a failed runtime check.
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
  });

  it("GET returns unreachable when the terminal answers a non-404 error", async () => {
    // A 5xx from /ws-files/read is a failed check, not proof the file is
    // missing — only a 404 authoritatively means "never started".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "internal" }), { status: 500 })),
    );

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("unreachable");
    expect(body.previewUrl).toBeNull();
    expect(body.runtimeError).toContain("500");
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
  });

  it("GET returns not_started when index.html is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
    );

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.previewUrl).toBeNull();
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
    // Without a ready static payload we must not mint or embed a preview
    // token — there is no instrumented document to honor the bridge.
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
  });

  it("POST for static projects never returns a preview token", async () => {
    // Static projects reject dev-server startup at the API boundary, so
    // the POST path must not mint a static preview token either.
    const res = await POST(
      new Request("https://x.test/api/studio-projects/proj-1/preview", { method: "POST" }) as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(400);
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
  });
});

describe("studio-projects preview route — workspace failure code threading (wave-4)", () => {
  // The exact string production stores as workspaceError when a repo-backed
  // prepare hits the terminal-server's fail-closed 503.
  const HOST_EXEC_STORED =
    'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}';

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function getPreview() {
    return GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
  }

  it("threads HOST_EXECUTION_DISABLED into runtimeErrorCode for a failed repo workspace", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: HOST_EXEC_STORED, framework: "nextjs",
    } as never);
    const body = await (await getPreview()).json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.runtimeErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("leaves generic workspace failures codeless", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: "terminal down", framework: "nextjs",
    } as never);
    const body = await (await getPreview()).json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.runtimeErrorCode).toBeNull();
  });

  // Deterministic derivation (follow-up to #901): a settled failure whose
  // stored error carries no embedded code — e.g. "Provisioning timed out"
  // from the stale-provisioning settle — still names the refusal when the
  // project is repo-backed and this deployment cannot execute host work.
  // Parsing the code back out of free text was the only channel #901 had,
  // and production's stored text defeated it.
  it("derives HOST_EXECUTION_DISABLED for a repo-backed failed workspace with a code-less stored error", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: "Provisioning timed out", framework: "nextjs",
      sourceType: "github",
    } as never);
    const body = await (await getPreview()).json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.runtimeErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("does not derive the refusal for a managed project with a code-less stored error", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: "Provisioning timed out", framework: "nextjs",
      sourceType: "blank",
    } as never);
    const body = await (await getPreview()).json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.runtimeErrorCode).toBeNull();
  });

  // Phase 2 §3.2: when the terminal reports sandboxed execution
  // available for this user, the same settled failure is retryable —
  // the deterministic refusal must NOT be derived.
  it("does not derive the refusal when the sandbox is available for the user", async () => {
    sandboxAvailableMock.mockResolvedValue(true);
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: "Provisioning timed out", framework: "nextjs",
      sourceType: "github",
    } as never);
    const body = await (await getPreview()).json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.runtimeErrorCode).toBeNull();
    expect(sandboxAvailableMock).toHaveBeenCalledWith("user-1");
  });

  // Route honesty (console-errors diagnosis): when the POST provisioning
  // branch fails with the host-execution refusal, the status must match
  // the code the body carries — 503, not an unmapped 500.
  function postPreview() {
    return POST(
      new Request("https://x.test/api/studio-projects/proj-1/preview", { method: "POST" }) as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
  }

  it("POST returns 503 when provisioning hits HOST_EXECUTION_DISABLED", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: HOST_EXEC_STORED, framework: "nextjs",
    } as never);
    provisionMock.mockRejectedValue(new Error(HOST_EXEC_STORED));
    const res = await postPreview();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("failed");
    expect(body.runtimeErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("POST keeps generic provisioning failures at 500", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: "terminal down", framework: "nextjs",
    } as never);
    provisionMock.mockRejectedValue(new Error("terminal down"));
    const res = await postPreview();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.runtimeErrorCode).toBeNull();
  });
});

describe("studio-projects preview route — workspace-not-found heal (round 5)", () => {
  const githubProject = {
    id: "proj-1",
    userId: "user-1",
    workspaceId: "ws-dead",
    workspaceRoot: "/data/workspaces/user-1/proj-1",
    workspaceStatus: "ready",
    sourceType: "github",
    framework: "nextjs",
    developmentCommand: "pnpm dev",
    packageManager: "pnpm",
  };

  function postPreview() {
    return POST(
      new Request("https://x.test/api/studio-projects/proj-1/preview", { method: "POST" }) as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ ...githubProject } as never);
    provisionMock.mockResolvedValue("ws-dead");
    startPreviewMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST heals a workspace-level 404 from start and retries with the recovered ID", async () => {
    startPreviewMock
      .mockRejectedValueOnce(new Error('Preview start failed (404): {"error":"Workspace not found"}'))
      .mockResolvedValueOnce({
        status: "starting", port: 3000, framework: "nextjs", command: "pnpm dev", startedAt: 123,
      } as never);
    ensureAliveMock.mockResolvedValue({ workspaceId: "ws-healed", reprepared: true } as never);

    const res = await postPreview();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("starting");
    expect(ensureAliveMock).toHaveBeenCalledWith("proj-1", "user-1", "ws-dead");
    expect(startPreviewMock).toHaveBeenCalledTimes(2);
    expect(startPreviewMock.mock.calls[1][0]).toBe("ws-healed");
    expect(reprepareMock).not.toHaveBeenCalled();
  });

  it("POST escalates to a full re-prepare when the bounded heal reports healFailed", async () => {
    startPreviewMock
      .mockRejectedValueOnce(new Error('Preview start failed (404): {"error":"Workspace not found"}'))
      .mockResolvedValueOnce({
        status: "starting", port: 3000, framework: "nextjs", command: "pnpm dev", startedAt: 123,
      } as never);
    ensureAliveMock.mockResolvedValue({ workspaceId: "ws-dead", reprepared: false, healFailed: true } as never);
    reprepareMock.mockResolvedValue("ws-fresh");

    const res = await postPreview();
    expect(res.status).toBe(200);
    expect(reprepareMock).toHaveBeenCalledWith("proj-1", "user-1");
    expect(startPreviewMock).toHaveBeenCalledTimes(2);
    expect(startPreviewMock.mock.calls[1][0]).toBe("ws-fresh");
  });

  it("POST does not heal or retry on a non-404 start failure", async () => {
    startPreviewMock.mockRejectedValue(new Error("Preview start failed (500): boom"));

    const res = await postPreview();
    expect(res.status).toBe(500);
    expect(startPreviewMock).toHaveBeenCalledTimes(1);
    expect(ensureAliveMock).not.toHaveBeenCalled();
    expect(reprepareMock).not.toHaveBeenCalled();
  });
});

/**
 * Round 13 (2026-11-17): the panel's failed-state Restart sends
 * { restart: true }, and the route must take the terminal's FORCE
 * restart path (restartPreviewInternal → PreviewManager's
 * forceRestart) instead of a plain start that can silently adopt a
 * wedged in-flight runtime. A restart with no live runtime to
 * restart falls back to a plain start; a bodyless POST is a plain
 * start, exactly as before.
 */
describe("studio-projects preview route — force restart (round 13)", () => {
  const githubProject = {
    id: "proj-1",
    userId: "user-1",
    workspaceId: "ws-1",
    workspaceRoot: "/data/workspaces/user-1/proj-1",
    workspaceStatus: "ready",
    sourceType: "github",
    framework: "nextjs",
    developmentCommand: "pnpm dev",
    packageManager: "pnpm",
  };

  function postPreview(body?: unknown) {
    return POST(
      new Request("https://x.test/api/studio-projects/proj-1/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }) as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ ...githubProject } as never);
    provisionMock.mockResolvedValue("ws-1");
    startPreviewMock.mockReset();
    restartPreviewMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST { restart: true } takes the force path and never plain-starts", async () => {
    restartPreviewMock.mockResolvedValue({
      status: "starting", port: 3000, framework: "nextjs", command: "pnpm dev", startedAt: 456,
    } as never);

    const res = await postPreview({ restart: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("starting");
    expect(restartPreviewMock).toHaveBeenCalledTimes(1);
    expect(restartPreviewMock.mock.calls[0][0]).toBe("ws-1");
    expect(restartPreviewMock.mock.calls[0][1]).toBe("user-1");
    expect(startPreviewMock).not.toHaveBeenCalled();
  });

  it("POST { restart: true } falls back to a plain start when no runtime exists to restart", async () => {
    restartPreviewMock.mockRejectedValue(new Error("No preview runtime to restart"));
    startPreviewMock.mockResolvedValue({
      status: "starting", port: 3000, framework: "nextjs", command: "pnpm dev", startedAt: 789,
    } as never);

    const res = await postPreview({ restart: true });
    expect(res.status).toBe(200);
    expect(restartPreviewMock).toHaveBeenCalledTimes(1);
    expect(startPreviewMock).toHaveBeenCalledTimes(1);
  });

  it("POST { restart: true } LOGS the fallback when the force restart throws (round 14)", async () => {
    // Round 14: the fallback used to be silent, so a "Restart" that
    // quietly became "reuse the same dead runtime" was invisible in
    // every surface. The fallback still happens — but it is logged.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    restartPreviewMock.mockRejectedValue(new Error("No preview runtime to restart"));
    startPreviewMock.mockResolvedValue({
      status: "starting", port: 3000, framework: "nextjs", command: "pnpm dev", startedAt: 790,
    } as never);

    const res = await postPreview({ restart: true });
    expect(res.status).toBe(200);
    expect(startPreviewMock).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes("preview:force_restart_fallback_to_start"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("No preview runtime to restart");
  });

  it("POST without a body is a plain start and never touches the force path", async () => {
    startPreviewMock.mockResolvedValue({
      status: "starting", port: 3000, framework: "nextjs", command: "pnpm dev", startedAt: 101,
    } as never);

    const res = await postPreview();
    expect(res.status).toBe(200);
    expect(startPreviewMock).toHaveBeenCalledTimes(1);
    expect(restartPreviewMock).not.toHaveBeenCalled();
  });

  it("POST { restart: false } is a plain start", async () => {
    startPreviewMock.mockResolvedValue({
      status: "starting", port: 3000, framework: "nextjs", command: "pnpm dev", startedAt: 102,
    } as never);

    const res = await postPreview({ restart: false });
    expect(res.status).toBe(200);
    expect(startPreviewMock).toHaveBeenCalledTimes(1);
    expect(restartPreviewMock).not.toHaveBeenCalled();
  });
});

describe("studio-projects preview route — stop lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ ...staticProject, framework: "nextjs" } as never);
    stopPreviewMock.mockResolvedValue(undefined);
  });

  function deletePreview() {
    return DELETE(
      new NextRequest("http://localhost/api/studio-projects/proj-1/preview", {
        method: "DELETE",
      }),
      makeParams("proj-1"),
    );
  }

  it("stops only the caller-owned project's workspace and records stopped state", async () => {
    const response = await deletePreview();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runtimeStatus: "stopped" });
    expect(getProjectMock).toHaveBeenCalledWith("proj-1", "user-1");
    expect(stopPreviewMock).toHaveBeenCalledWith("ws-1", "user-1");
    expect(updateProjectRuntimeMock).toHaveBeenCalledWith("proj-1", "user-1", {
      runtimeStatus: "stopped",
      previewUrl: null,
      runtimeError: null,
    });
  });

  it("does not stop a workspace when the caller does not own the project", async () => {
    getProjectMock.mockResolvedValue(null);

    const response = await deletePreview();

    expect(response.status).toBe(404);
    expect(stopPreviewMock).not.toHaveBeenCalled();
    expect(updateProjectRuntimeMock).not.toHaveBeenCalled();
  });
});
