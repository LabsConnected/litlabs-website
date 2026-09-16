import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const box = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  capturedProfile: null as unknown,
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/social-server", () => ({
  apiFetch: (...args: unknown[]) => box.apiFetch(...args),
}));

vi.mock("./ProfileClient", () => ({
  __esModule: true,
  default: (props: { profile: unknown }) => {
    box.capturedProfile = props.profile;
    return <div data-testid="profile-client" />;
  },
}));

import UserProfilePage from "./page";

const REAL_PROFILE = {
  id: "u_123",
  username: "novabuilder",
  displayName: "Nova Builder",
  avatarUrl: null,
  coverUrl: null,
  bio: "Building things with AI.",
  website: "nova.example",
  location: "Detroit, MI",
  counts: { posts: 12, followers: 34, following: 5 },
  viewer: { following: false },
};

function okJson(payload: unknown) {
  return {
    status: 200,
    ok: true,
    json: async () => payload,
  };
}

function statusOnly(status: number) {
  return { status, ok: false, json: async () => null };
}

const pageProps = (handle = "novabuilder") => ({
  params: Promise.resolve({ handle }),
  searchParams: Promise.resolve({}),
});

describe("UserProfilePage (/u/[handle])", () => {
  beforeEach(() => {
    box.apiFetch.mockReset();
    box.capturedProfile = null;
  });

  it("fetches the profile by handle and passes the real API data through", async () => {
    box.apiFetch.mockResolvedValue(okJson(REAL_PROFILE));
    const html = renderToString(await UserProfilePage(pageProps()));

    expect(box.apiFetch).toHaveBeenCalledWith(
      "/api/users/by-username/novabuilder",
    );
    // Every rendered value comes from the API payload — nothing fabricated.
    expect(box.capturedProfile).toMatchObject({
      id: "u_123",
      username: "novabuilder",
      displayName: "Nova Builder",
      bio: "Building things with AI.",
      website: "nova.example",
      location: "Detroit, MI",
      counts: { posts: 12, followers: 34, following: 5 },
      viewer: { following: false },
    });
    expect(html).toContain("profile-client");
  });

  it("accepts a { user }-wrapped payload shape", async () => {
    box.apiFetch.mockResolvedValue(okJson({ user: REAL_PROFILE }));
    renderToString(await UserProfilePage(pageProps()));
    expect(box.capturedProfile).toMatchObject({ id: "u_123" });
  });

  it("renders not-found when the API returns 404", async () => {
    box.apiFetch.mockResolvedValue(statusOnly(404));
    await expect(UserProfilePage(pageProps("ghost"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("renders not-found for 401/403 instead of leaking existence", async () => {
    box.apiFetch.mockResolvedValue(statusOnly(401));
    await expect(UserProfilePage(pageProps("ghost"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    box.apiFetch.mockResolvedValue(statusOnly(403));
    await expect(UserProfilePage(pageProps("ghost"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("renders not-found for a malformed payload", async () => {
    box.apiFetch.mockResolvedValue(okJson({ nope: true }));
    await expect(UserProfilePage(pageProps("ghost"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});
