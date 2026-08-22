/**
 * REMOTE / TOOLS fail-closed regression tests.
 *
 * Contract under test:
 *   1. REMOTE execution that cannot be performed TERMINATES. It never
 *      silently relocates the command to local execution.
 *   2. Missing auth, expired auth, unreachable service, failed session
 *      and failed execution are all hard errors with typed reasons.
 *   3. The UI transport projection never contradicts itself — the header
 *      cannot claim REMOTE while the footer claims LOCAL.
 *
 * The local-executor spy is the load-bearing assertion in most of these:
 * it is what turns "we believe there is no fallback" into "no fallback
 * was invoked on this path".
 */

import { describe, it, expect, vi } from "vitest";
import { executeCommand } from "../lib/command-execution.js";
import {
  RemoteUnavailableError,
  isRemoteUnavailable,
  CREDENTIAL_CLEARING_REASONS,
} from "../lib/remote-unavailable.js";
import { deriveTransport } from "../lib/transport-projection.js";

const REMOTEABLE = (cmd: string) => ["status", "build", "test", "check", "run"].includes(cmd);

/** Build deps with spies; remote behaviour is supplied per test. */
function deps(remote: () => Promise<number>, opts: { useRemote?: boolean } = {}) {
  const localExecutor = vi.fn(async () => 0);
  const errors: string[] = [];
  return {
    localExecutor,
    errors,
    args: {
      useRemote: opts.useRemote ?? true,
      isRemoteable: REMOTEABLE,
      remoteExecutor: remote,
      localExecutor,
      onError: (m: string) => errors.push(m),
    },
  };
}

describe("fail-closed: remote unavailable", () => {
  it("does not execute locally when the remote service is unreachable", async () => {
    const d = deps(async () => {
      throw new RemoteUnavailableError("service_unavailable", "connect ECONNREFUSED.");
    });
    const outcome = await executeCommand("build", d.args);

    expect(d.localExecutor).not.toHaveBeenCalled();
    expect(outcome.path).toBe("none");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toBe("service_unavailable");
  });

  it("reports an explicit remote error rather than a generic failure", async () => {
    const d = deps(async () => {
      throw new RemoteUnavailableError("service_unavailable", "connect ECONNREFUSED.");
    });
    await executeCommand("build", d.args);

    expect(d.errors.join("\n")).toContain("Remote execution unavailable");
    expect(d.errors.join("\n")).toContain("ECONNREFUSED");
  });

  it("never suggests local execution as a remedy", () => {
    for (const reason of [
      "not_authenticated", "auth_expired", "auth_revoked",
      "service_unavailable", "session_failed", "execution_failed",
    ] as const) {
      const err = new RemoteUnavailableError(reason);
      expect(err.message.toLowerCase()).not.toContain("without --remote");
      expect(err.message.toLowerCase()).not.toContain("local execution");
    }
  });

  it("refuses an unsupported remote command without running it locally", async () => {
    const d = deps(async () => 0);
    const outcome = await executeCommand("desktop-only-thing", d.args);

    expect(d.localExecutor).not.toHaveBeenCalled();
    expect(outcome.path).toBe("none");
    expect(outcome.reason).toBe("unsupported_command");
  });
});

describe("fail-closed: authentication", () => {
  it("hard fails with no valid auth and does not invoke the local runner", async () => {
    const d = deps(async () => {
      throw new RemoteUnavailableError("not_authenticated");
    });
    const outcome = await executeCommand("status", d.args);

    expect(d.localExecutor).not.toHaveBeenCalled();
    expect(outcome.path).toBe("none");
    expect(outcome.reason).toBe("not_authenticated");
  });

  it("hard fails when refresh fails; stale credentials do not continue", async () => {
    const d = deps(async () => {
      throw new RemoteUnavailableError("auth_expired");
    });
    const outcome = await executeCommand("test", d.args);

    expect(d.localExecutor).not.toHaveBeenCalled();
    expect(outcome.reason).toBe("auth_expired");
    expect(outcome.exitCode).toBe(1);
  });

  it("marks expired and revoked sessions as credential-clearing", () => {
    expect(CREDENTIAL_CLEARING_REASONS.has("auth_expired")).toBe(true);
    expect(CREDENTIAL_CLEARING_REASONS.has("auth_revoked")).toBe(true);
    // A network outage must NOT wipe a perfectly good credential.
    expect(CREDENTIAL_CLEARING_REASONS.has("service_unavailable")).toBe(false);
  });

  it("auth failure is never converted into permission to run locally", async () => {
    for (const reason of ["not_authenticated", "auth_expired", "auth_revoked"] as const) {
      const d = deps(async () => { throw new RemoteUnavailableError(reason); });
      const outcome = await executeCommand("status", d.args);
      expect(d.localExecutor).not.toHaveBeenCalled();
      expect(outcome.path).not.toBe("local");
    }
  });
});

describe("successful REMOTE execution", () => {
  it("runs the remote runner and never the local one", async () => {
    const remote = vi.fn(async () => 0);
    const d = deps(remote);
    const outcome = await executeCommand("build", d.args);

    expect(remote).toHaveBeenCalledTimes(1);
    expect(d.localExecutor).not.toHaveBeenCalled();
    expect(outcome.path).toBe("remote");
    expect(outcome.exitCode).toBe(0);
  });

  it("propagates a non-zero remote exit code as a remote outcome", async () => {
    const d = deps(async () => 2);
    const outcome = await executeCommand("test", d.args);

    expect(outcome.path).toBe("remote");
    expect(outcome.exitCode).toBe(2);
    expect(d.localExecutor).not.toHaveBeenCalled();
  });

  it("uses the local runner only when --remote was not requested", async () => {
    const remote = vi.fn(async () => 0);
    const d = deps(remote, { useRemote: false });
    const outcome = await executeCommand("build", d.args);

    expect(d.localExecutor).toHaveBeenCalledTimes(1);
    expect(remote).not.toHaveBeenCalled();
    expect(outcome.path).toBe("local");
  });
});

describe("cancellation / unexpected errors", () => {
  it("surfaces an untyped remote error without falling back", async () => {
    const d = deps(async () => { throw new Error("socket hang up"); });
    const outcome = await executeCommand("run", d.args);

    expect(d.localExecutor).not.toHaveBeenCalled();
    expect(outcome.path).toBe("none");
    expect(outcome.reason).toBe("execution_failed");
    expect(d.errors.join("\n")).toContain("socket hang up");
  });

  it("treats a cancelled remote operation as failure, not as local work", async () => {
    const d = deps(async () => {
      throw new RemoteUnavailableError("execution_failed", "Aborted by operator.");
    });
    const outcome = await executeCommand("build", d.args);

    expect(outcome.path).toBe("none");
    expect(d.localExecutor).not.toHaveBeenCalled();
  });

  it("identifies typed remote errors structurally", () => {
    expect(isRemoteUnavailable(new RemoteUnavailableError("session_failed"))).toBe(true);
    expect(isRemoteUnavailable(new Error("nope"))).toBe(false);
    expect(isRemoteUnavailable(null)).toBe(false);
  });
});

describe("UI transport projection", () => {
  const LOCAL_STATES = ["starting", "ready", "error"];
  const REMOTE_STATES = ["offline", "connecting", "connected", "reconnecting", "error"];

  it("never renders a REMOTE header beside a LOCAL footer", () => {
    for (const localRuntime of LOCAL_STATES) {
      for (const remoteRuntime of REMOTE_STATES) {
        const t = deriveTransport({ localRuntime, remoteRuntime });
        if (t.headerLabel.startsWith("REMOTE")) {
          expect(t.footerLabel).not.toContain("LOCAL");
        }
        // The footer is a TOOLS claim in every state — it is structurally
        // incapable of contradicting the header's execution-path claim.
        expect(t.footerLabel).not.toContain("LOCAL");
      }
    }
  });

  it("claims REMOTE only when the connection is actually established", () => {
    expect(deriveTransport({ localRuntime: "ready", remoteRuntime: "connected" }).headerLabel).toBe("REMOTE");
    for (const remoteRuntime of ["connecting", "reconnecting", "error"]) {
      const t = deriveTransport({ localRuntime: "ready", remoteRuntime });
      expect(t.headerLabel).not.toBe("REMOTE");
      expect(t.remoteActive).toBe(false);
    }
  });

  it("reports executionPath remote only when remote is active", () => {
    expect(deriveTransport({ localRuntime: "ready", remoteRuntime: "connected" }).executionPath).toBe("remote");
    // A half-open remote transport must not read as working local execution.
    for (const remoteRuntime of ["connecting", "reconnecting", "error"]) {
      expect(deriveTransport({ localRuntime: "ready", remoteRuntime }).executionPath).toBe("none");
    }
  });

  it("shows LOCAL in the header only when remote is offline", () => {
    const t = deriveTransport({ localRuntime: "ready", remoteRuntime: "offline" });
    expect(t.headerLabel).toBe("LOCAL");
    expect(t.executionPath).toBe("local");
    expect(t.showRemote).toBe(false);
  });

  it("renders the signed-out projection with no transport claim", () => {
    const t = deriveTransport({ localRuntime: "ready", remoteRuntime: "connected", signedIn: false });
    expect(t.headerLabel).toBe("SIGNED OUT");
    expect(t.executionPath).toBe("none");
    expect(t.remoteActive).toBe(false);
  });

  it("keeps the footer TOOLS label truthful about local tooling", () => {
    expect(deriveTransport({ localRuntime: "ready", remoteRuntime: "connected" }).footerLabel).toBe("TOOLS");
    expect(deriveTransport({ localRuntime: "error", remoteRuntime: "connected" }).footerLabel).toBe("TOOLS ERR");
    expect(deriveTransport({ localRuntime: "starting", remoteRuntime: "offline" }).footerLabel).toBe("TOOLS…");
  });
});
