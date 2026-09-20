import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  userId: "user-123" as string | null,
  authHost: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async (request: NextRequest) => {
    mocks.authHost = request.nextUrl.hostname;
    return { userId: mocks.userId, clerkId: mocks.userId };
  }),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: (request: NextRequest) => Promise<Response>) => handler,
}));

vi.mock("@/lib/user-db", () => ({
  getUserByClerkId: vi.fn(async () => ({
    id: "db-user-123",
    clerk_id: "user-123",
    email: "member@example.com",
    name: "Member",
    username: "member",
    avatar_url: null,
    bio: null,
    website: null,
    location: null,
    created_at: "2026-01-01T00:00:00.000Z",
  })),
  updateUserProfile: vi.fn(),
  getOrCreateUser: vi.fn(),
}));

import { GET } from "./route";

function request(host = "www.litlabs.net") {
  return new NextRequest(`https://${host}/api/settings/profile`);
}

describe("GET /api/settings/profile auth boundary", () => {
  it("returns the profile for a signed-in request on www production", async () => {
    mocks.userId = "user-123";
    const response = await GET(request("www.litlabs.net"));

    expect(response.status).toBe(200);
    expect(mocks.authHost).toBe("www.litlabs.net");
    expect((await response.json()).user.clerk_id).toBe("user-123");
  });

  it("returns 401 for a signed-out request", async () => {
    mocks.userId = null;
    const response = await GET(request());

    expect(response.status).toBe(401);
  });
});
