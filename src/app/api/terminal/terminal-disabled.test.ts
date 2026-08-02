import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "test-user" }),
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn().mockReturnValue({ token: "fake-token", expiresAt: Date.now() + 300000 }),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn().mockResolvedValue({ workspaceId: "ws-1" }),
}));

import { GET as tokenGET } from "@/app/api/terminal/token/route";

function makeRequest(url: string) {
  const req = new Request(`http://localhost:3000${url}`);
  Object.defineProperty(req, "nextUrl", {
    value: new URL(`http://localhost:3000${url}`),
    writable: false,
  });
  return req as never;
}

describe("terminal API — feature disabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 503 when NEXT_PUBLIC_TERMINAL_ENABLED=false", async () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "false");
    const res = await tokenGET(makeRequest("/api/terminal/token"));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.disabled).toBe(true);
    expect(json.error).toMatch(/disabled/i);
  });

  it("returns 503 when TERMINAL_ENABLED=false", async () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", undefined);
    vi.stubEnv("TERMINAL_ENABLED", "false");
    const res = await tokenGET(makeRequest("/api/terminal/token"));
    expect(res.status).toBe(503);
  });
});

describe("terminal API — feature enabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not return 503 when terminal is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "true");
    const res = await tokenGET(makeRequest("/api/terminal/token"));
    expect(res.status).not.toBe(503);
  });
});
