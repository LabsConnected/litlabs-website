// @vitest-environment jsdom
/**
 * Public /showcase index regression.
 *
 * The /showcase index used to push signed-out visitors to /sign-in even
 * though the /showcase/[slug] demo pages are public. Now:
 *  1. LayoutShell treats /showcase as hybrid-public (marketing chrome for
 *     signed-out visitors, AppShell for signed-in).
 *  2. The index renders PublicShowcaseGallery for signed-out visitors —
 *     a real gallery of the public demos, not a login wall.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type * as React from "react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/showcase"),
}));

let mockIsSignedIn = false;
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: vi.fn(() => ({
    isSignedIn: mockIsSignedIn,
    isLoaded: true,
    userId: mockIsSignedIn ? "user_123" : null,
  })),
}));

// Same chrome stubs as the hybrid-chrome regression test — isolate the
// LayoutShell branch under test.
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/FooterWrapper", () => ({ default: () => null }));
vi.mock("@/components/CookieConsent", () => ({ default: () => null }));
vi.mock("@/components/UserSync", () => ({ default: () => null }));
vi.mock("@/components/AnimatedBackgroundWrapper", () => ({ default: () => null }));
vi.mock("@/components/ServiceWorkerRegistration", () => ({ default: () => null }));
vi.mock("@/components/companion/GlobalCompanion", () => ({ GlobalCompanion: () => null }));
vi.mock("@/components/youtube/YouTubePlayerShell", () => ({ YouTubePlayerShell: () => null }));

describe("LayoutShell hybrid-public chrome for /showcase", () => {
  it("renders marketing chrome (not the app shell) for signed-out visitors", async () => {
    mockIsSignedIn = false;
    const { default: LayoutShell } = await import("@/components/LayoutShell");

    render(
      <LayoutShell>
        <div data-testid="showcase-content">gallery</div>
      </LayoutShell>,
    );

    expect(screen.getByRole("link", { name: /LiTTree LabStudios home/i })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.getByTestId("showcase-content")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
  });

  it("does NOT render marketing chrome for signed-in visitors (AppShell owns nav)", async () => {
    mockIsSignedIn = true;
    const { default: LayoutShell } = await import("@/components/LayoutShell");

    render(
      <LayoutShell>
        <div data-testid="showcase-content">gallery</div>
      </LayoutShell>,
    );

    expect(screen.queryByRole("link", { name: /LiTTree LabStudios home/i })).toBeNull();
    expect(screen.getByTestId("showcase-content")).toBeTruthy();
  });
});

describe("PublicShowcaseGallery", () => {
  it("lists every public demo with a link, honestly labeled as simulations", async () => {
    const { default: PublicShowcaseGallery } = await import(
      "@/app/(app)/showcase/PublicShowcaseGallery"
    );
    render(<PublicShowcaseGallery />);

    // All three demos from the shared catalog render as cards.
    const { PROJECT_LIST } = await import("@/app/(app)/showcase/projects");
    for (const project of PROJECT_LIST) {
      const link = screen.getByRole("link", { name: new RegExp(project.title) });
      expect(link.getAttribute("href")).toBe(`/showcase/${project.slug}`);
    }

    // Honest labeling: simulations, not customer work.
    expect(screen.getByText(/illustrative simulations/i)).toBeTruthy();

    // Clear path forward for the visitor.
    expect(
      screen.getByRole("link", { name: /start building free/i }),
    ).toBeTruthy();
  });

  it("stays in sync with the [slug] demo pages (same catalog)", async () => {
    const { PROJECTS } = await import("@/app/(app)/showcase/projects");
    // generateStaticParams in [slug]/page.tsx builds from this same
    // catalog — every slug here must resolve to a demo page.
    expect(Object.keys(PROJECTS).length).toBeGreaterThan(0);
    for (const slug of Object.keys(PROJECTS)) {
      expect(PROJECTS[slug].slug).toBe(slug);
    }
  });
});
