import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(() => Promise.resolve({ workspaceId: "ws-123" })),
}));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "tok", expiresAt: 9999999999 })),
}));
// Unconfigured production: no implicit fallback, so the resolver yields "".
vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => ""),
}));

import { GET } from "./route";

describe("workspace-state with no terminal configured", () => {
  it("returns an explicit 503 and never calls fetch", async () => {
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("terminal_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});
