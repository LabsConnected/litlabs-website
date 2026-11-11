// @vitest-environment jsdom
/**
 * No chat-agent pop-up on Studio surfaces (Larry's directive,
 * 2026-11-10): "on missions, agents, and assets, I don't want the
 * left side pop up chat agent in there."
 *
 * Missions / Agents / Assets are Studio stations — URLs under
 * /studio (stations ride query params on /studio; Mission Control
 * is /studio/mission-control). LayoutShell must never mount the
 * GlobalCompanion there: Studio's own chat is the integrated
 * in-layout surface. On non-Studio app pages the companion remains
 * the site-wide assistant (control cases below pin that boundary).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type * as React from "react";

const nav = vi.hoisted(() => ({ pathname: "/studio" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: vi.fn(() => ({ isSignedIn: true, isLoaded: true })),
}));

// Marker companion: renders a testid ONLY if LayoutShell mounts it.
vi.mock("@/components/companion/GlobalCompanion", () => ({
  GlobalCompanion: () => <div data-testid="global-companion-mounted" />,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/FooterWrapper", () => ({ default: () => null }));
vi.mock("@/components/CookieConsent", () => ({ default: () => null }));
vi.mock("@/components/UserSync", () => ({ default: () => null }));
vi.mock("@/components/AnimatedBackgroundWrapper", () => ({ default: () => null }));
vi.mock("@/components/ServiceWorkerRegistration", () => ({ default: () => null }));
vi.mock("@/components/youtube/YouTubePlayerShell", () => ({ YouTubePlayerShell: () => null }));

async function renderAt(pathname: string) {
  nav.pathname = pathname;
  const { default: LayoutShell } = await import("@/components/LayoutShell");
  return render(
    <LayoutShell>
      <div data-testid="page-content">content</div>
    </LayoutShell>,
  );
}

describe("LayoutShell companion suppression on Studio surfaces", () => {
  it("never mounts the companion on /studio (Missions/Agents/Assets stations ride this path)", async () => {
    await renderAt("/studio");
    expect(screen.getByTestId("page-content")).toBeTruthy();
    expect(screen.queryByTestId("global-companion-mounted")).toBeNull();
  });

  it("never mounts the companion on /studio/mission-control", async () => {
    await renderAt("/studio/mission-control");
    expect(screen.queryByTestId("global-companion-mounted")).toBeNull();
  });

  it("still mounts the companion on ordinary app pages (control)", async () => {
    await renderAt("/projects");
    expect(screen.getByTestId("global-companion-mounted")).toBeTruthy();
  });
});
