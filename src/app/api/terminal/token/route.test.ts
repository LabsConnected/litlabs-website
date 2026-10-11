import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Terminal token route: public access is disabled until container isolation
 * is verified. These tests prove the gate runs before any workspace lookup
 * or token minting, that owners still pass, and that the flag ships disabled.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/terminal-auth", () => ({ createTerminalToken: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  updateProjectWorkspace: vi.fn(),
}));
vi.mock("@/lib/terminal-internal-client", () => ({ getWorkspaceInternal: vi.fn() }));
vi.mock("@/config/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/config/feature-flags")>(
    "@/config/feature-flags",
  );
  return { ...actual, isFeatureEnabled: vi.fn(actual.isFeatureEnabled) };
});

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { createTerminalToken } from "@/lib/terminal-auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { FEATURE_FLAGS, isFeatureEnabled } from "@/config/feature-flags";

const request = (query = "") =>
  new NextRequest(`http://localhost/api/terminal/token${query}`);

describe("GET /api/terminal/token", () => {
  const originalOwners = process.env.TERMINAL_OWNER_CLERK_IDS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TERMINAL_OWNER_CLERK_IDS = "user_owner";
    vi.mocked(createTerminalToken).mockReturnValue({ token: "tok", expiresAt: 123 } as never);
  });

  afterEach(() => {
    if (originalOwners === undefined) delete process.env.TERMINAL_OWNER_CLERK_IDS;
    else process.env.TERMINAL_OWNER_CLERK_IDS = originalOwners;
  });

  it("ships with public terminal access disabled", () => {
    expect(FEATURE_FLAGS.terminalRuntime.enabled).toBe(false);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(createTerminalToken).not.toHaveBeenCalled();
  });

  it("blocks a non-owner before any workspace lookup or token minting", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_public" } as never);
    const res = await GET(request("?projectId=p1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("TERMINAL_DISABLED");
    expect(verifyProjectWorkspace).not.toHaveBeenCalled();
    expect(createTerminalToken).not.toHaveBeenCalled();
  });

  it("still lets a terminal owner through the flag (the server enforces isolation)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_owner" } as never);
    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(createTerminalToken).toHaveBeenCalledWith("user_owner");
  });

  it("lets a non-owner through only when the flag is explicitly enabled", async () => {
    vi.mocked(isFeatureEnabled).mockReturnValueOnce(true);
    vi.mocked(auth).mockResolvedValue({ userId: "user_public" } as never);
    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(createTerminalToken).toHaveBeenCalledWith("user_public");
  });
});
