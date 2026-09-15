import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server auth — the page under test branches on its result.
const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

// Stub the two views so the test asserts the page's branching logic
// without pulling in the theme provider tree or next/link.
vi.mock("./PublicShowcaseGallery", () => ({
  default: () => <div data-testid="public-gallery">Public gallery</div>,
}));
vi.mock("./ShowcaseSignedIn", () => ({
  default: () => <div data-testid="signed-in-showcase">Signed-in showcase</div>,
}));

import ShowcasePage from "./page";

describe("ShowcasePage (server-rendered)", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("renders the public gallery for signed-out visitors with no loading gate", async () => {
    authMock.mockResolvedValue({ userId: null, clerkId: null });
    const html = renderToString(await ShowcasePage());
    expect(html).toContain("Public gallery");
    expect(html).not.toContain("Signed-in showcase");
    expect(html).not.toMatch(/loading showcase/i);
  });

  it("renders the signed-in showcase for authenticated users", async () => {
    authMock.mockResolvedValue({ userId: "user_abc123", clerkId: "user_abc123" });
    const html = renderToString(await ShowcasePage());
    expect(html).toContain("Signed-in showcase");
    expect(html).not.toContain("Public gallery");
  });

  it("treats the anonymous-dev stand-in as signed-out", async () => {
    authMock.mockResolvedValue({ userId: "anonymous-dev", clerkId: null });
    const html = renderToString(await ShowcasePage());
    expect(html).toContain("Public gallery");
    expect(html).not.toContain("Signed-in showcase");
  });
});
