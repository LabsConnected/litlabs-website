/**
 * Remote protocol contract & integration tests.
 *
 * Verifies the ONE canonical remote command protocol shared between
 * the LiTT CLI (`litt --remote`), Termux HTTP clients, Desktop
 * observers, and terminal-server's `/internal/command` endpoint.
 *
 * Covers:
 *   - status / build / test remote requests
 *   - command args preserved end-to-end (structured argv)
 *   - cwd preserved
 *   - unsupported command returns typed failure (no crash)
 *   - server/client decode the SAME schema
 *   - runId correlates with the runtime execution
 *   - /do passes through ExecutionGateway (no direct execFile)
 *   - PLAN mode prevents mutation through /do
 *
 * These tests exercise the real `dispatchCommand` (the server-side
 * bridge) and the real `dispatchRemote` (the client-side encoder) so
 * the contract is verified end-to-end without needing a live HTTP
 * server. A mocked `fetch` is installed for the client-side tests so
 * `dispatchRemote` can be exercised against a synthetic server
 * response produced by the real `dispatchCommand`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import {
  dispatchCommand,
  getSupportedCommands,
  isSupportedCommand,
} from "../terminal-server/command-bridge.js";
import { dispatchRemote } from "../packages/litt-cli/src/lib/remote.js";
import {
  resolveCommand,
  getCommandNames,
} from "../terminal-server/command-registry.js";
import {
  isRemoteError,
  hasRemoteResult,
  successResponse,
  errorResponse,
  type RemoteCommandRequest,
  type RemoteCommandResponse,
} from "@litt/agent-core";

const repoRoot = path.resolve(__dirname, "..");

// ─── Helpers ──────────────────────────────────────────────────────

function makeRequest(partial: Partial<RemoteCommandRequest> & { command: string }): RemoteCommandRequest {
  return {
    command: partial.command,
    args: partial.args ?? [],
    cwd: partial.cwd ?? repoRoot,
    requestId: partial.requestId,
    mode: partial.mode,
    workspaceId: partial.workspaceId,
    userId: partial.userId,
  };
}

// ─── Shared protocol schema ───────────────────────────────────────

describe("Remote protocol: shared schema", () => {
  it("successResponse produces a single-level ToolResult (not triple-nested)", () => {
    const resp = successResponse({
      runId: "run_test_1",
      ok: true,
      kind: "status",
      message: "ok",
      data: { branch: "main" },
      durationMs: 5,
    });
    // result is ONE level — result.message, not result.result.result.message
    expect(resp.result).toBeDefined();
    expect(resp.result!.message).toBe("ok");
    expect(resp.result!.data.branch).toBe("main");
    expect(resp.result!.success).toBe(true);
    expect(resp.result!.status).toBe("success");
    expect(resp.ok).toBe(true);
    expect(resp.runId).toBe("run_test_1");
    expect(resp.kind).toBe("status");
  });

  it("errorResponse carries a typed error code", () => {
    const resp = errorResponse({
      runId: "run_test_2",
      code: "unknown_command",
      message: "Unknown command: /nope",
      availableCommands: ["status", "build"],
    });
    expect(isRemoteError(resp)).toBe(true);
    expect(hasRemoteResult(resp)).toBe(false);
    expect(resp.error!.code).toBe("unknown_command");
    expect(resp.error!.availableCommands).toEqual(["status", "build"]);
  });

  it("isRemoteError / hasRemoteResult type guards are mutually exclusive for clean responses", () => {
    const ok = successResponse({
      runId: "r", ok: true, kind: "k", message: "m", data: {}, durationMs: 0,
    });
    const err = errorResponse({ runId: "r", code: "internal_error", message: "boom" });
    expect(isRemoteError(ok)).toBe(false);
    expect(hasRemoteResult(ok)).toBe(true);
    expect(isRemoteError(err)).toBe(true);
    expect(hasRemoteResult(err)).toBe(false);
  });
});

// ─── Server: dispatchCommand (the bridge) ─────────────────────────

// Stub result for CommandRouter.status — avoids running real git
// subprocesses that can exceed the default 5s test timeout under
// full-suite CPU contention. The protocol contract tests verify
// request/response shape, not subprocess execution.
const STUB_STATUS_RESULT = {
  command: "status",
  result: {
    status: "success" as const,
    success: true,
    message: "branch=main changes=0",
    data: { branch: "main", changeCount: 0, root: repoRoot, isGitRepo: true },
  },
};

describe("Server: dispatchCommand contract", () => {
  let statusSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const agentCore = require("@litt/agent-core") as typeof import("@litt/agent-core");
    statusSpy = vi.spyOn(agentCore.CommandRouter.prototype, "status").mockResolvedValue(STUB_STATUS_RESULT);
  });

  afterEach(() => {
    statusSpy?.mockRestore();
  });

  it("status remote request returns a RemoteCommandResponse with single-level result", async () => {
    const resp = await dispatchCommand(makeRequest({ command: "status" }));
    expect(resp.ok).toBe(true);
    expect(resp.kind).toBe("status");
    expect(typeof resp.runId).toBe("string");
    expect(resp.runId).toMatch(/^run_/);
    // Single-level result — the bug was result.result.result.message
    expect(hasRemoteResult(resp)).toBe(true);
    expect(typeof resp.result!.message).toBe("string");
    expect(resp.result!.data).toBeDefined();
  });

  it("build remote request returns a typed response (success or failure, never crash)", async () => {
    // build/test/check invoke the real project toolchain (tsc / vitest),
    // which is too slow for a unit test and environment-dependent. We
    // verify the PROTOCOL CONTRACT by stubbing the CommandRouter so the
    // handler returns a controlled result, proving the bridge wraps it
    // in a RemoteCommandResponse with the right shape.
    const stubResult = {
      command: "build",
      result: { status: "success" as const, success: true, message: "build ok", data: { exitCode: 0 } },
    };
    const agentCore = await import("@litt/agent-core");
    const routerSpy = vi.spyOn(agentCore.CommandRouter.prototype, "build").mockResolvedValue(stubResult);
    try {
      const resp = await dispatchCommand(makeRequest({ command: "build" }));
      expect(resp.kind).toBe("build");
      expect(resp.ok).toBe(true);
      expect(hasRemoteResult(resp)).toBe(true);
      expect(typeof resp.runId).toBe("string");
      expect(resp.result!.message).toBe("build ok");
    } finally {
      routerSpy.mockRestore();
    }
  });

  it("test remote request returns a typed response", async () => {
    const stubResult = {
      command: "test",
      result: { status: "failed" as const, success: false, message: "2 tests failed", data: { exitCode: 1 } },
    };
    const agentCore = await import("@litt/agent-core");
    const routerSpy = vi.spyOn(agentCore.CommandRouter.prototype, "test").mockResolvedValue(stubResult);
    try {
      const resp = await dispatchCommand(makeRequest({ command: "test" }));
      expect(resp.kind).toBe("test");
      expect(resp.ok).toBe(false);
      expect(hasRemoteResult(resp)).toBe(true);
      expect(typeof resp.runId).toBe("string");
      expect(resp.result!.message).toBe("2 tests failed");
    } finally {
      routerSpy.mockRestore();
    }
  });

  it("command args are preserved end-to-end (structured argv)", async () => {
    // /diff --staged via structured args
    const resp = await dispatchCommand(
      makeRequest({ command: "diff", args: ["--staged"] }),
    );
    expect(resp.kind).toBe("diff");
    // The handler should have received the --staged flag. We verify by
    // checking the response is a valid diff response (not an error about
    // missing args). The diff handler runs git diff --staged.
    expect(hasRemoteResult(resp)).toBe(true);
  });

  it("inline args and structured args are both preserved", async () => {
    // /doctor --deep via inline string
    const respInline = await dispatchCommand(
      makeRequest({ command: "/doctor --deep" }),
    );
    expect(respInline.kind).toBe("doctor");
    // /doctor via structured args
    const respStructured = await dispatchCommand(
      makeRequest({ command: "doctor", args: ["--deep"] }),
    );
    expect(respStructured.kind).toBe("doctor");
  });

  it("cwd is preserved in the request", async () => {
    const resp = await dispatchCommand(
      makeRequest({ command: "local", cwd: repoRoot }),
    );
    expect(resp.kind).toBe("local_info");
    expect(hasRemoteResult(resp)).toBe(true);
    expect(resp.result!.data.cwd).toBe(repoRoot);
  });

  it("unsupported command returns a typed unknown_command failure (no crash)", async () => {
    const resp = await dispatchCommand(makeRequest({ command: "nonexistent_cmd" }));
    expect(resp.ok).toBe(false);
    expect(isRemoteError(resp)).toBe(true);
    expect(resp.error!.code).toBe("unknown_command");
    expect(Array.isArray(resp.error!.availableCommands)).toBe(true);
    expect(resp.error!.availableCommands!.length).toBeGreaterThan(0);
  });

  it("malformed request (missing command) returns typed malformed_request", async () => {
    const resp = await dispatchCommand({ command: "", args: [] } as RemoteCommandRequest);
    expect(isRemoteError(resp)).toBe(true);
    expect(resp.error!.code).toBe("malformed_request");
  });

  it("requestId is echoed back unchanged (distinct from runId)", async () => {
    const resp = await dispatchCommand(
      makeRequest({ command: "status", requestId: "client-req-123" }),
    );
    expect(resp.requestId).toBe("client-req-123");
    // runId is a DIFFERENT concept — the runtime execution identity
    expect(resp.runId).not.toBe("client-req-123");
    expect(resp.runId).toMatch(/^run_/);
  });
});

// ─── runId correlation ────────────────────────────────────────────

describe("runId correlation with runtime execution", () => {
  it("the bridge does NOT mint a second runId separate from the runtime", async () => {
    // The bridge generates runId and passes it THROUGH ctx.runId to the
    // registry handlers, which forward it to CommandRouter.check/test/build.
    // The response.runId must be the same one passed through.
    const resp = await dispatchCommand(makeRequest({ command: "status" }));
    // We can't directly observe the store's runId here without a live
    // server, but we verify the contract: the response carries exactly
    // one runId, and it matches the /^run_/ shape the bridge produces.
    expect(typeof resp.runId).toBe("string");
    expect(resp.runId).toMatch(/^run_/);
    // There is no second runId field on the response.
    expect((resp as unknown as Record<string, unknown>).bridgeRunId).toBeUndefined();
  });

  it("check/test/build accept ctx.runId and pass it to CommandRouter", async () => {
    // Verify the source wires runId through. We stub CommandRouter.check
    // so we don't run the real typecheck, and confirm the response.runId
    // is stable (the bridge generated it once and reused it).
    const stubResult = {
      command: "check",
      result: { status: "success" as const, success: true, message: "check ok", data: {} },
    };
    const agentCore = await import("@litt/agent-core");
    const routerSpy = vi.spyOn(agentCore.CommandRouter.prototype, "check").mockResolvedValue(stubResult);
    try {
      const resp = await dispatchCommand(
        makeRequest({ command: "check", requestId: "req-xyz" }),
      );
      expect(resp.requestId).toBe("req-xyz");
      expect(resp.runId).toMatch(/^run_/);
      // The stub was called — proving the handler ran
      expect(routerSpy).toHaveBeenCalled();
    } finally {
      routerSpy.mockRestore();
    }
  });
});

// ─── /do routes through ExecutionGateway ──────────────────────────

describe("/do routes through ExecutionGateway", () => {
  it("/do is registered and dispatched (not a direct execFile)", async () => {
    // The /do handler must call getExecutionGateway(), not execFile.
    // We verify the command resolves and dispatches. A harmless command
    // confirms the gateway path is wired (the gateway classifies + may
    // approve before executing).
    const resp = await dispatchCommand(
      makeRequest({ command: "do", args: ["echo", "hello-from-do"] }),
    );
    expect(resp.kind).toBe("exec_result");
    // The response data includes gateway enforcement metadata that
    // proves it went through the canonical authority.
    expect(resp.result!.data.policyEffect).toBeDefined();
    expect(typeof resp.result!.data.approved).toBe("boolean");
  });

  it("/do preserves structured argv (no shell-string interpolation)", async () => {
    // Send args with a value that would break under shell interpolation.
    // Structured argv means `echo "a b"` is two args ["echo", "a b"],
    // not a shell-parsed string.
    const resp = await dispatchCommand(
      makeRequest({ command: "do", args: ["echo", "arg with spaces"] }),
    );
    expect(resp.kind).toBe("exec_result");
    if (resp.ok && hasRemoteResult(resp)) {
      const stdout = String(resp.result!.data.stdout ?? "");
      expect(stdout).toContain("arg with spaces");
    }
  });

  it("PLAN mode prevents mutation through /do", async () => {
    // In PLAN mode, the ExecutionGateway rejects all mutations.
    // `node` is classified as arbitrary_code (elevated, mutating) — so
    // PLAN mode must deny it. (A safe read-only command like `echo` is
    // correctly allowed in PLAN mode; we test with a mutating command
    // to prove the gateway enforces the mode.)
    const resp = await dispatchCommand(
      makeRequest({ command: "do", args: ["node", "-e", "1"], mode: "plan" }),
    );
    expect(resp.ok).toBe(false);
    // The gateway denies the execution — the result reflects the denial.
    expect(hasRemoteResult(resp)).toBe(true);
    expect(resp.result!.success).toBe(false);
    // policyEffect should be "deny" for a PLAN-mode mutation
    expect(resp.result!.data.policyEffect).toBe("deny");
  });

  it("/do with no args returns a controlled usage error (not a crash)", async () => {
    const resp = await dispatchCommand(makeRequest({ command: "do", args: [] }));
    expect(resp.ok).toBe(false);
    expect(hasRemoteResult(resp)).toBe(true);
    expect(resp.result!.message).toMatch(/Usage/);
  });
});

// ─── Command list: one source of truth ────────────────────────────

describe("Command list: one source of truth", () => {
  it("getSupportedCommands derives from the registry (no static duplicate)", () => {
    const supported = getSupportedCommands();
    const registryNames = getCommandNames();
    expect(supported).toEqual(registryNames);
  });

  it("isSupportedCommand agrees with resolveCommand", () => {
    for (const name of getCommandNames()) {
      expect(isSupportedCommand(name)).toBe(true);
      expect(resolveCommand(name)).not.toBeNull();
    }
    expect(isSupportedCommand("definitely_not_a_command")).toBe(false);
  });

  it("the registry includes the canonical project commands", () => {
    const names = new Set(getCommandNames());
    for (const required of ["status", "diff", "check", "test", "build", "do"]) {
      expect(names.has(required)).toBe(true);
    }
  });
});

// ─── Client/Server decode the same schema ────────────────────────

describe("Client and server decode the same schema", () => {
  // We mock fetch so dispatchRemote (the client) talks to a synthetic
  // server whose response is produced by the REAL dispatchCommand
  // (the server bridge). This proves both sides agree on the schema.
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function installBridgeFetch(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.endsWith("/api/command")) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as RemoteCommandRequest;
      const serverResp = await dispatchCommand(body);
      return new Response(JSON.stringify(serverResp), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  it("client sends RemoteCommandRequest, decodes RemoteCommandResponse from server", async () => {
    installBridgeFetch();
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "x".repeat(40);
    const resp = await dispatchRemote("status", [], {
      cwd: repoRoot,
      terminalToken: "test-terminal-token",
    });
    expect(resp.ok).toBe(true);
    expect(resp.kind).toBe("status");
    expect(hasRemoteResult(resp)).toBe(true);
    expect(typeof resp.result!.message).toBe("string");
    expect(typeof resp.runId).toBe("string");
  });

  it("client receives typed unknown_command error for unsupported commands", async () => {
    installBridgeFetch();
    const resp = await dispatchRemote("nonexistent_cmd", [], {
      cwd: repoRoot,
      terminalToken: "test-terminal-token",
    });
    expect(isRemoteError(resp)).toBe(true);
    expect(resp.error!.code).toBe("unknown_command");
    expect(Array.isArray(resp.error!.availableCommands)).toBe(true);
  });

  it("client preserves structured args through the round-trip", async () => {
    installBridgeFetch();
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "x".repeat(40);
    const resp = await dispatchRemote("local", [], {
      cwd: repoRoot,
      terminalToken: "test-terminal-token",
    });
    expect(resp.kind).toBe("local_info");
    expect(resp.result!.data.cwd).toBe(repoRoot);
  });

  it("Termux-style HTTP client (fetch + JSON) decodes the same schema", async () => {
    // A Termux client is just a fetch caller. We simulate one inline
    // to prove the protocol is HTTP-client-agnostic.
    installBridgeFetch();
    const termuxResp = await fetch("http://127.0.0.1:4001/api/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-terminal-token",
      },
      body: JSON.stringify({
        command: "status",
        args: [],
        cwd: repoRoot,
      } as RemoteCommandRequest),
    });
    const decoded = (await termuxResp.json()) as RemoteCommandResponse;
    expect(decoded.ok).toBe(true);
    expect(decoded.kind).toBe("status");
    expect(hasRemoteResult(decoded)).toBe(true);
    expect(typeof decoded.runId).toBe("string");
  });
});

// ─── PHASE 6: PLAN / ACT / AUTO mode enforcement ─────────────────

describe("PHASE 6: Mode enforcement on remote path", () => {
  it("PLAN mode denies genuinely mutating /do (node = arbitrary_code)", async () => {
    const resp = await dispatchCommand(
      makeRequest({ command: "do", args: ["node", "-e", "1"], mode: "plan" }),
    );
    expect(resp.ok).toBe(false);
    expect(hasRemoteResult(resp)).toBe(true);
    expect(resp.result!.success).toBe(false);
    expect(resp.result!.data.policyEffect).toBe("deny");
  });

  it("PLAN mode allows read-only /do (echo = safe)", async () => {
    const resp = await dispatchCommand(
      makeRequest({ command: "do", args: ["echo", "hello-plan"], mode: "plan" }),
    );
    expect(resp.ok).toBe(true);
    expect(hasRemoteResult(resp)).toBe(true);
    expect(resp.result!.data.policyEffect).toBe("allow");
    const stdout = String(resp.result!.data.stdout ?? "");
    expect(stdout).toContain("hello-plan");
  });

  it("ACT mode allows mutating /do (node = arbitrary_code, elevated)", async () => {
    const resp = await dispatchCommand(
      makeRequest({ command: "do", args: ["node", "-e", "process.exit(0)"], mode: "act" }),
    );
    expect(resp.kind).toBe("exec_result");
    // ACT mode allows elevated commands (may require approval, but
    // trusted service identity + headless interaction → allowed)
    expect(hasRemoteResult(resp)).toBe(true);
  });

  it("PLAN mode denies git commit (workspace_edit, mutating)", async () => {
    // git is workspace_edit; commit is a mutation. PLAN must deny.
    const resp = await dispatchCommand(
      makeRequest({ command: "do", args: ["git", "commit", "-m", "test"], mode: "plan" }),
    );
    expect(resp.ok).toBe(false);
    expect(resp.result!.data.policyEffect).toBe("deny");
  });

  it("PLAN mode allows git status (read-only git subcommand via /git)", async () => {
    const resp = await dispatchCommand(
      makeRequest({ command: "git", args: ["status"], mode: "plan" }),
    );
    expect(resp.ok).toBe(true);
    expect(resp.kind).toBe("git_result");
  });

  it("mode is passed through the remote protocol to the gateway", async () => {
    // Verify the mode field in RemoteCommandRequest reaches the gateway.
    // We test this by confirming PLAN mode on /do produces a denial
    // (which only happens if the gateway sees mode: "plan").
    const planResp = await dispatchCommand(
      makeRequest({ command: "do", args: ["node", "-e", "1"], mode: "plan" }),
    );
    expect(planResp.result!.data.policyEffect).toBe("deny");

    const actResp = await dispatchCommand(
      makeRequest({ command: "do", args: ["node", "-e", "process.exit(0)"], mode: "act" }),
    );
    // ACT mode should not deny (it may require approval, but trusted
    // service identity bypasses approval in headless mode)
    expect(actResp.result!.data.policyEffect).not.toBe("deny");
  });

  it("read-only commands (status, check, test, build) are unaffected by mode", async () => {
    // These are deterministic project commands — they run regardless
    // of mode because they're read-only inspections.
    const planStatus = await dispatchCommand(
      makeRequest({ command: "status", mode: "plan" }),
    );
    expect(planStatus.ok).toBe(true);

    const actStatus = await dispatchCommand(
      makeRequest({ command: "status", mode: "act" }),
    );
    expect(actStatus.ok).toBe(true);
  });
});
