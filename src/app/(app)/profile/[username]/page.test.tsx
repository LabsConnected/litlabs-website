import { describe, it, expect, vi } from "vitest";
import { permanentRedirect } from "next/navigation";
import LegacyProfileRedirectPage from "./page";

vi.mock("next/navigation", () => ({
  permanentRedirect: vi.fn(),
}));

const permanentRedirectMock = vi.mocked(permanentRedirect);

describe("legacy /profile/[username] page", () => {
  it("permanently redirects to the canonical /u/[handle] profile", async () => {
    permanentRedirectMock.mockClear();
    await LegacyProfileRedirectPage({
      params: Promise.resolve({ username: "mallory" }),
    });
    expect(permanentRedirectMock).toHaveBeenCalledWith("/u/mallory");
  });

  it("URL-encodes handles with special characters", async () => {
    permanentRedirectMock.mockClear();
    await LegacyProfileRedirectPage({
      params: Promise.resolve({ username: "foo bar" }),
    });
    expect(permanentRedirectMock).toHaveBeenCalledWith("/u/foo%20bar");
  });

  it("never renders the old fabricated-person content", async () => {
    // permanentRedirect throws in production; the mock swallows it, so if
    // we get here without rendering anything, the page redirects unconditionally.
    permanentRedirectMock.mockClear();
    const result = await LegacyProfileRedirectPage({
      params: Promise.resolve({ username: "mallory" }),
    });
    expect(permanentRedirectMock).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });
});
