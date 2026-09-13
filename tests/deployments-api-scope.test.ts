// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  gte: vi.fn(),
  result: {
    data: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: (() => {
    const query = {
      select: mocks.select,
      eq: mocks.eq,
      order: mocks.order,
      limit: mocks.limit,
      gte: mocks.gte,
      then: (resolve: (value: typeof mocks.result) => unknown) =>
        Promise.resolve(mocks.result).then(resolve),
    };
    mocks.from.mockReturnValue(query);
    mocks.select.mockReturnValue(query);
    mocks.eq.mockReturnValue(query);
    mocks.order.mockReturnValue(query);
    mocks.limit.mockReturnValue(query);
    mocks.gte.mockReturnValue(query);
    return { from: mocks.from };
  })(),
}));

const { GET } = await import("@/app/api/deployments/route");

describe("GET /api/deployments account isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-a", clerkId: "user-a" });
    mocks.result.data = [];
    mocks.result.error = null;
  });

  it("rejects unauthenticated callers before querying deployment data", async () => {
    mocks.auth.mockResolvedValue({ userId: null, clerkId: null });

    const response = await GET(new NextRequest("http://localhost/api/deployments"));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reads the user-scoped deployment table and always filters by caller", async () => {
    const response = await GET(new NextRequest("http://localhost/api/deployments"));

    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("project_deployments");
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(mocks.gte).not.toHaveBeenCalled();
  });

  it("keeps project filters inside the authenticated account scope", async () => {
    await GET(new NextRequest("http://localhost/api/deployments?projectId=project-7&hours=24"));

    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(mocks.eq).toHaveBeenCalledWith("integration_project_id", "project-7");
    expect(mocks.gte).toHaveBeenCalledWith("created_at", expect.any(String));
  });
});
