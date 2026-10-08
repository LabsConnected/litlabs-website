import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repo = vi.hoisted(() => ({
  getVisualBuild: vi.fn(),
  updateVisualBuild: vi.fn(),
  getAssetManifest: vi.fn(),
  getPreviewCapture: vi.fn(),
  getVisualReview: vi.fn(),
}));
const runVisualBuild = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve({ userId: "u1" })) }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (h: unknown) => h }));
vi.mock("@/lib/visual-builds/repository", () => repo);
vi.mock("@/lib/visual-builds/orchestrator", () => ({ runVisualBuild }));
// Unconfigured production: the resolver yields "".
vi.mock("@/lib/terminal-url", () => ({ getTerminalServerUrl: vi.fn(() => "") }));

import { POST } from "./route";

const ctx = { params: Promise.resolve({ projectId: "p1", buildId: "b1" }) };
const post = (action: string) =>
  (POST as unknown as (r: NextRequest, c: typeof ctx) => Promise<Response>)(
    new NextRequest("http://localhost/api/projects/p1/visual-builds/b1", {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
    ctx,
  );

afterEach(() => vi.unstubAllEnvs());

describe("visual build actions with no terminal configured", () => {
  it("still lets a saved build be approved (DB-only)", async () => {
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "");
    repo.getVisualBuild.mockResolvedValue({ id: "b1", summary: {} });
    repo.updateVisualBuild.mockResolvedValue({ id: "b1", status: "complete" });
    const res = await post("approve");
    expect(res.status).toBe(200);
    expect(repo.updateVisualBuild).toHaveBeenCalled();
  });

  it("returns 503 for retry, which needs the terminal, before running anything", async () => {
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "");
    const res = await post("retry");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("terminal_not_configured");
    expect(runVisualBuild).not.toHaveBeenCalled();
  });
});
