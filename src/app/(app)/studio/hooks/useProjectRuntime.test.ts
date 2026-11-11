import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useProjectRuntime } from "./useProjectRuntime";

// Mutable search params so a test can simulate a project switch.
const mockSearchParams = vi.hoisted(() => ({ current: "" }));

// Minimal browser-environment mocks for rendering the real hook.
vi.mock("next/navigation", () => {
  const router = { replace: () => {}, push: () => {}, refresh: () => {}, prefetch: () => {} };
  return {
    useRouter: () => router,
    usePathname: () => "/studio",
    useSearchParams: () => new URLSearchParams(mockSearchParams.current),
  };
});

vi.mock("@/hooks/useClerkAuth", () => {
  const auth = {
    userId: "user-1",
    getToken: async () => null,
    isLoaded: true,
    isSignedIn: true,
  };
  return { useClerkAuth: () => auth };
});

const WORKSPACE_READY = {
  phase: "ready",
  workspaceProvisioned: true,
  workspaceStatus: "ready",
  terminalConnected: false,
  terminalServerReachable: false,
  terminalSessionId: null,
  executionAvailable: false,
  projectId: "project-1",
  projectName: "Test project",
  repository: null,
  branch: "main",
  sourceType: "blank",
  sourceKind: "managed",
  sourceLabel: "LiTT Managed",
  sourceStatus: "ready",
  versionControl: "git",
  githubConnected: false,
  workspaceId: "workspace-1",
  workspacePath: "/work",
  previewState: "idle",
  logsState: "idle",
  deploymentState: "none",
  readAccess: false,
  writeSurfaceAvailable: false,
  writeAccess: false,
  writeApprovalRequired: true,
  voiceConfigured: false,
  voiceSessionConnected: false,
  lastCheckedAt: "2026-09-28T00:00:00.000Z",
};

/** Stub fetch, routing /api/project-runtime and the terminal probe by URL. */
function mockRuntimeFetch(serverReachable: boolean) {
  const fn = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/capabilities/project-terminal")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ serverReachable }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => WORKSPACE_READY,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("useProjectRuntime — single terminal/runtime truth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearchParams.current = "";
    useTerminalStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useTerminalStore.getState().reset();
  });

  it("marks execution available with phase 'ready' when the server is reachable but no PTY is attached", async () => {
    // Fresh load / refresh: the PTY drawer was never opened (store is in its
    // default disconnected state), but the terminal server is alive.
    mockRuntimeFetch(true);

    const { result } = renderHook(() => useProjectRuntime());

    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    // THE key regression: LiTT can execute a command after navigation/refresh
    // without the interactive PTY. PTY attachment must never gate execution.
    expect(result.current.state.terminalConnected).toBe(false);
    expect(result.current.state.terminalServerReachable).toBe(true);
    expect(result.current.state.executionAvailable).toBe(true);

    // The canonical terminal derivation still reports the PTY honestly.
    expect(result.current.terminal.status).toBe("disconnected");
    expect(result.current.terminal.serverReachable).toBe(true);
    expect(result.current.terminal.execution).toBe("idle");
    expect(result.current.terminal.usable).toBe(false);
  });

  it("reports phase 'terminal_unreachable' when the terminal server is down", async () => {
    mockRuntimeFetch(false);

    const { result } = renderHook(() => useProjectRuntime());

    await waitFor(() => expect(result.current.state.phase).toBe("terminal_unreachable"));
    expect(result.current.state.executionAvailable).toBe(false);
    expect(result.current.state.terminalServerReachable).toBe(false);
    expect(result.current.terminal.serverReachable).toBe(false);
    expect(result.current.terminal.execution).toBe("unavailable");
  });

  it("exposes the full terminal derivation — no consumer needs the store", async () => {
    mockRuntimeFetch(true);
    useTerminalStore.getState().setVerifiedSession({
      sessionId: "sess-1",
      cwd: "/work",
      shell: "/bin/bash",
    });
    useTerminalStore.getState().setHeartbeat(new Date().toISOString());

    const { result } = renderHook(() => useProjectRuntime());

    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    expect(result.current.state.terminalConnected).toBe(true);
    expect(result.current.terminal.status).toBe("connected");
    expect(result.current.terminal.sessionId).toBe("sess-1");
    expect(result.current.terminal.cwd).toBe("/work");
    expect(result.current.terminal.execution).toBe("available");
    expect(result.current.terminal.usable).toBe(true);
    expect(result.current.terminal.error).toBeNull();
    expect(result.current.terminal.failureStage).toBeNull();
  });

  it("derives 'connecting' while the PTY session is not yet verified", async () => {
    mockRuntimeFetch(true);
    useTerminalStore.setState({ status: "connecting", sessionId: null, cwd: null });

    const { result } = renderHook(() => useProjectRuntime());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.terminal.execution).toBe("connecting");
    // Execution is still available: the SERVER is reachable — the PTY
    // drawer connecting is a status-feed detail, not an execution blocker.
    expect(result.current.state.executionAvailable).toBe(true);
    expect(result.current.state.phase).toBe("ready");
  });

  it("stamps lastCheckedAt when a resolve fails, so a settled failure is distinguishable from never-checked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { result } = renderHook(() => useProjectRuntime());

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
    // The preserved state must carry the attempt's stamp: consumers gate
    // "unresolved" on the epoch sentinel, and a completed-but-failed
    // resolve must not masquerade as never-resolved (or vice versa).
    expect(Date.parse(result.current.state.lastCheckedAt)).toBeGreaterThan(0);
  });

  it("re-enters the unresolved state when the project identity changes, until the new resolve lands", async () => {
    mockSearchParams.current = "project=project-1";
    mockRuntimeFetch(true);

    const { result, rerender } = renderHook(() => useProjectRuntime());
    await waitFor(() => expect(result.current.state.projectId).toBe("project-1"));
    expect(result.current.loading).toBe(false);

    mockSearchParams.current = "project=project-2";
    rerender();

    // In the window before the new project's resolve settles, the hook
    // must present the unresolved placeholder again — never the previous
    // project's settled state (which downstream surfaces would render as
    // this project's truth).
    expect(result.current.loading).toBe(true);
    expect(result.current.state.projectId).toBeNull();
    expect(Date.parse(result.current.state.lastCheckedAt)).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("useConnectionSummary never reads the terminal store directly", () => {
    // Architectural invariant: useProjectRuntime is the ONLY reader of the
    // terminal store (besides the TerminalPanel producer). useConnectionSummary
    // maps runtime.terminal instead of re-deriving — no import, no selector call.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "useConnectionSummary.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["']@\/stores\/useTerminalStore["']/);
    expect(source).not.toMatch(/useTerminalStore\s*\(/);
  });
});
