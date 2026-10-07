import { describe, it, expect } from "vitest";
import { bindWorkspaceFromToken } from "../workspace-token-bind";

describe("bindWorkspaceFromToken", () => {
  it("accepts a bound token whose wid matches the header", () => {
    expect(
      bindWorkspaceFromToken({
        tokenWorkspaceId: "ws-alice",
        headerWorkspaceId: "ws-alice",
      }),
    ).toEqual({ ok: true, workspaceId: "ws-alice" });
  });

  it("refuses a missing header", () => {
    const result = bindWorkspaceFromToken({
      tokenWorkspaceId: "ws-alice",
      headerWorkspaceId: undefined,
    });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Missing X-Workspace-Id header",
    });
  });

  it("refuses an unbound token even when the header names an owned workspace", () => {
    const result = bindWorkspaceFromToken({
      tokenWorkspaceId: undefined,
      headerWorkspaceId: "ws-alice",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("Workspace-bound token required");
    }
  });

  it("refuses a token bound to a different workspace than the header", () => {
    const result = bindWorkspaceFromToken({
      tokenWorkspaceId: "ws-alice",
      headerWorkspaceId: "ws-bob",
    });
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Token workspace does not match",
    });
  });
});
