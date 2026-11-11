import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attemptWorkspacePrepare,
  clearHostExecSettled,
  isHostExecDisabledResponse,
  isHostExecSettled,
} from "./host-exec-session";

const CODED_503 = {
  error: "Execution is unavailable on this deployment. No verified sandbox isolation exists.",
  code: "HOST_EXECUTION_DISABLED",
  context: "workspace.prepare",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("host-exec-session guard", () => {
  beforeEach(() => {
    clearHostExecSettled();
  });

  it("detects only the coded 503 as the host-execution refusal", () => {
    expect(isHostExecDisabledResponse(503, CODED_503)).toBe(true);
    expect(isHostExecDisabledResponse(503, { code: "TERMINAL_UNAVAILABLE" })).toBe(false);
    expect(isHostExecDisabledResponse(500, CODED_503)).toBe(false);
    expect(isHostExecDisabledResponse(503, null)).toBe(false);
    expect(isHostExecDisabledResponse(503, undefined)).toBe(false);
  });

  it("settles after one coded refusal — repeated attempts issue no further fetches", async () => {
    const doFetch = vi.fn(async () => jsonResponse(503, CODED_503));

    const first = await attemptWorkspacePrepare("proj-repo", doFetch);
    expect(first.kind).toBe("unavailable");
    expect(isHostExecSettled("proj-repo")).toBe(true);
    expect(doFetch).toHaveBeenCalledTimes(1);

    // The retry-loop regression: mounts/polls/retries after the verdict
    // must resolve locally instead of re-POSTing prepare.
    const second = await attemptWorkspacePrepare("proj-repo", doFetch);
    const third = await attemptWorkspacePrepare("proj-repo", doFetch);
    expect(second.kind).toBe("unavailable");
    expect(third.kind).toBe("unavailable");
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("settling is per-project — other projects still attempt prepare", async () => {
    const doFetch = vi.fn(async () => jsonResponse(503, CODED_503));
    await attemptWorkspacePrepare("proj-repo", doFetch);
    const other = await attemptWorkspacePrepare("proj-other", doFetch);
    expect(other.kind).toBe("unavailable");
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("returns ready payload on an OK ready response and does not settle", async () => {
    const doFetch = vi.fn(async () =>
      jsonResponse(200, { workspaceId: "ws-1", workspaceStatus: "ready" }),
    );
    const outcome = await attemptWorkspacePrepare("proj-managed", doFetch);
    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") expect(outcome.payload.workspaceId).toBe("ws-1");
    expect(isHostExecSettled("proj-managed")).toBe(false);
  });

  it("non-coded failures are NOT settled — a later attempt retries for real", async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, { workspaceStatus: "ready" }));
    const first = await attemptWorkspacePrepare("proj-flaky", doFetch);
    expect(first.kind).toBe("failed");
    if (first.kind === "failed") expect(first.message).toBe("boom");
    expect(isHostExecSettled("proj-flaky")).toBe(false);
    const second = await attemptWorkspacePrepare("proj-flaky", doFetch);
    expect(second.kind).toBe("ready");
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("a network throw is a failure, not an unavailable verdict", async () => {
    const doFetch = vi.fn(async () => {
      throw new Error("socket hangup");
    });
    const outcome = await attemptWorkspacePrepare("proj-net", doFetch);
    expect(outcome.kind).toBe("failed");
    expect(isHostExecSettled("proj-net")).toBe(false);
  });
});
