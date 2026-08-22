import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchRemote, RemoteUnavailableError, clearTerminalTokenCache } from "../lib/remote.js";
import { createCredentialStore } from "../lib/auth/credential-store.js";
import type { CredentialStore } from "../lib/auth/types.js";
import { getAuthSession, resetAuthSession } from "../lib/auth/auth-session.js";
import { projectTransport } from "../ink/transport-projection.js";

describe("REMOTE fail-closed execution", () => {
  let store: CredentialStore;

  beforeEach(() => {
    delete process.env.LITT_CLERK_TOKEN;
    clearTerminalTokenCache();
    resetAuthSession();
    store = createCredentialStore("memory");
    getAuthSession({ storage: store });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTerminalTokenCache();
    resetAuthSession();
  });

  it("hard-fails missing auth before any remote or local command runner can execute", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(dispatchRemote("run", ["node", "-e", "console.log('must-not-run')"]))
      .rejects.toMatchObject({ code: "remote_unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears stale credentials and hard-fails when refresh is rejected", async () => {
    await store.set("tokens", JSON.stringify({
      accessToken: "stale-access",
      refreshToken: "revoked-refresh",
      expiresAt: Date.now() - 1_000,
    }));
    await store.set("user", JSON.stringify({ sub: "stale-user" }));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "revoked" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(dispatchRemote("status"))
      .rejects.toBeInstanceOf(RemoteUnavailableError);
    expect(await store.get("tokens")).toBeNull();
    expect(await store.get("user")).toBeNull();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/api/command"))).toBe(false);
  });

  it("surfaces cancellation/transport failure without attempting another execution path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("operation cancelled"));

    await expect(dispatchRemote("run", [], { terminalToken: "terminal-jwt" }))
      .rejects.toMatchObject({ code: "remote_unavailable", message: expect.stringContaining("cancelled") });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("executes the remote endpoint exactly once on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      runId: "remote-run",
      kind: "run",
      result: { status: "success", success: true, message: "runner-ok", data: {} },
      timestamp: Date.now(),
      durationMs: 1,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await dispatchRemote("run", ["node", "-e", "console.log('runner-ok')"], {
      terminalToken: "terminal-jwt",
    });
    expect(result.result?.message).toBe("runner-ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/command$/);
  });
});

describe("transport projection", () => {
  it("reports REMOTE only for an established remote connection", () => {
    expect(projectTransport("connected")).toBe("REMOTE");
    expect(projectTransport("connecting")).toBe("CONNECTING");
    expect(projectTransport("reconnecting")).toBe("CONNECTING");
    expect(projectTransport("offline")).toBe("TOOLS");
    expect(projectTransport("error")).toBe("REMOTE ERR");
  });
});
