import { describe, expect, it, vi, beforeEach } from "vitest";
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

import { GET, POST } from "./route";
import { updateUserProfile } from "@/lib/user-db";

const mockUpdateUserProfile = vi.mocked(updateUserProfile);

function request(host = "www.litlabs.net") {
  return new NextRequest(`https://${host}/api/settings/profile`);
}

function postRequest(body: unknown) {
  return new NextRequest("https://www.litlabs.net/api/settings/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const dbUser = {
  id: "db-user-123",
  clerk_id: "user-123",
  email: "member@example.com",
  name: "Member",
  username: "member",
  avatar_url: null,
  bio: null,
  website: null,
  location: null,
};

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

describe("POST /api/settings/profile", () => {
  beforeEach(() => {
    mocks.userId = "user-123";
    vi.clearAllMocks();
    mockUpdateUserProfile.mockResolvedValue(dbUser as never);
  });

  it("returns 401 for a signed-out request", async () => {
    mocks.userId = null;
    const response = await POST(postRequest({ name: "Member" }));

    expect(response.status).toBe(401);
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it("returns 400 for an unparseable body", async () => {
    const response = await POST(postRequest("not-json{{"));

    expect(response.status).toBe(400);
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it("returns 400 when no valid fields are present", async () => {
    const response = await POST(postRequest({ foo: "bar", count: 3 }));

    expect(response.status).toBe(400);
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it("persists allowed fields and returns the saved user on success", async () => {
    const response = await POST(
      postRequest({ name: "  Larry  ", bio: "hello", location: "Detroit" }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.message).toBe("Profile updated successfully");
    expect(json.user.clerk_id).toBe("user-123");
    // Names are trimmed server-side.
    expect(mockUpdateUserProfile).toHaveBeenCalledWith("user-123", {
      name: "Larry",
      bio: "hello",
      location: "Detroit",
    });
  });

  it("strips fields the API does not accept (cosmetic prefs, unknowns)", async () => {
    const response = await POST(
      postRequest({
        name: "Member",
        wallpaper: "afterglow",
        accentColor: "#fbbf24",
        sidebarStyle: "compact",
        isAdmin: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith("user-123", {
      name: "Member",
    });
  });

  it("returns 404 when the user row does not exist", async () => {
    mockUpdateUserProfile.mockRejectedValue(new Error("User not found"));

    const response = await POST(postRequest({ name: "Member" }));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("User not found");
  });

  it("returns 409 on a username unique conflict", async () => {
    mockUpdateUserProfile.mockRejectedValue(
      new Error(
        'Failed to update profile: duplicate key value violates unique constraint "users_username_key"',
      ),
    );

    const response = await POST(postRequest({ username: "taken" }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Username already taken");
  });

  it("returns 500 on an unexpected database error", async () => {
    mockUpdateUserProfile.mockRejectedValue(new Error("connection reset"));

    const response = await POST(postRequest({ name: "Member" }));

    expect(response.status).toBe(500);
  });
});
