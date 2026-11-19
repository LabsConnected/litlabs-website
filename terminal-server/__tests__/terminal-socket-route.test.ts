/**
 * Socket gate routing (terminal bridge, TERMINAL-BRIDGE-SPEC-2026-11-17
 * §2.2/§5.2) — the pty-isolation-enforcement pattern applied to the
 * socket layer: the assertion that matters is WHICH route a socket
 * takes, because the sandbox route must never become a host spawn
 * and a refused socket must keep today's refusal.
 *
 * server.ts itself boots on import, so the gate middleware's
 * decision lives in terminal-socket-route.ts and is tested here;
 * server.ts's wiring of the three outcomes is pinned by the source
 * assertions at the bottom (the refusal string, word for word, and
 * the sandbox branch returning before any host PTY work).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { decideTerminalSocketRoute } from "../terminal-socket-route";

const OWNER = "user_owner";
const WORKSPACE = "ws-3648d2ea-b9c5004a";

function gate(open: boolean) {
  return vi.fn((_userId: string) => open);
}

describe("decideTerminalSocketRoute", () => {
  it("host verdict enabled → host route, sandbox gate never consulted", () => {
    const sandboxAvailable = gate(true);
    expect(
      decideTerminalSocketRoute({
        terminalExecution: "enabled",
        userId: OWNER,
        workspaceId: WORKSPACE,
        sandboxAvailable,
      }),
    ).toBe("host");
    // Trusted-local behavior is byte-identical: even a token with no
    // workspace takes the host path when the verdict enables it.
    expect(
      decideTerminalSocketRoute({
        terminalExecution: "enabled",
        userId: OWNER,
        workspaceId: undefined,
        sandboxAvailable,
      }),
    ).toBe("host");
    expect(sandboxAvailable).not.toHaveBeenCalled();
  });

  it("production-like verdict + workspace token + gate open → sandbox route", () => {
    const sandboxAvailable = gate(true);
    expect(
      decideTerminalSocketRoute({
        terminalExecution: "disabled",
        userId: OWNER,
        workspaceId: WORKSPACE,
        sandboxAvailable,
      }),
    ).toBe("sandbox");
    expect(sandboxAvailable).toHaveBeenCalledWith(OWNER);
  });

  it("gate closed → refuse (each denial reason collapses to the same refusal)", () => {
    // provider-disabled / routing-not-enabled / not-owner /
    // canary-not-verified all surface as isAvailableFor === false.
    const sandboxAvailable = gate(false);
    expect(
      decideTerminalSocketRoute({
        terminalExecution: "disabled",
        userId: OWNER,
        workspaceId: WORKSPACE,
        sandboxAvailable,
      }),
    ).toBe("refuse");
  });

  it("no workspace on the token → refuse, gate never consulted", () => {
    const sandboxAvailable = gate(true);
    expect(
      decideTerminalSocketRoute({
        terminalExecution: "disabled",
        userId: OWNER,
        workspaceId: undefined,
        sandboxAvailable,
      }),
    ).toBe("refuse");
    expect(sandboxAvailable).not.toHaveBeenCalled();
  });

  it("no authenticated user → refuse", () => {
    expect(
      decideTerminalSocketRoute({
        terminalExecution: "disabled",
        userId: undefined,
        workspaceId: WORKSPACE,
        sandboxAvailable: gate(true),
      }),
    ).toBe("refuse");
  });
});

describe("server.ts gate wiring (source pins)", () => {
  const serverSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "server.ts"),
    "utf-8",
  );

  it("the refuse route keeps today's refusal string, word for word", () => {
    expect(serverSource).toContain(
      'next(new Error("Terminal unavailable: isolation not verified"))',
    );
  });

  it("the sandbox route is marked on the socket and the connection handler returns before host PTY work", () => {
    expect(serverSource).toContain('socket.data.terminalRoute = "sandbox"');
    const branchIdx = serverSource.indexOf('socket.data.terminalRoute === "sandbox"');
    const hostCreateIdx = serverSource.indexOf("ptyManager.create({");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(hostCreateIdx).toBeGreaterThan(branchIdx);
    // The branch returns from the connection handler.
    const branchBlock = serverSource.slice(branchIdx, branchIdx + 200);
    expect(branchBlock).toContain("return;");
  });

  it("provisioning progress is emitted while the sandbox session starts (§2.6)", () => {
    expect(serverSource).toContain('"terminal:status"');
    expect(serverSource).toContain('state: "provisioning"');
  });
});
