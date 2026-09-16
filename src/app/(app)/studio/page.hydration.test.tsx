import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import "@testing-library/jest-dom";

const authState = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => authState,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("project=p1"),
  usePathname: () => "/studio",
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#000",
      surface: "#111",
      primary: "#72f238",
      text: "#fff",
      textMuted: "#888",
      border: "#333",
    },
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./components/CommandStudio", () => ({
  default: () => <div data-testid="command-studio-mock" />,
}));

const { default: StudioPage } = await import("./page");

describe("StudioPage hydration", () => {
  beforeEach(() => {
    authState.isLoaded = true;
    authState.isSignedIn = true;
  });

  it("first client render matches SSR even when Clerk resolves before hydration (React #418)", async () => {
    // Server render: Clerk isLoaded is false during SSR, so the loading
    // state is what lands in the HTML document.
    authState.isLoaded = false;
    const html = renderToString(<StudioPage />);
    expect(html).toContain('data-testid="studio-loading"');

    // Client boot: Clerk's injected session state makes isLoaded true
    // synchronously — before hydration runs.
    authState.isLoaded = true;

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const recoverableErrors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <StudioPage />, {
        onRecoverableError: (e) => recoverableErrors.push(e),
      });
    });

    // Without the mounted gate, the first client render produces the full
    // CommandStudio tree against the loading-state HTML → hydration
    // mismatch → recoverable error → forced client re-render.
    expect(recoverableErrors).toHaveLength(0);

    // After mount, the real Studio renders.
    expect(container.querySelector("[data-testid='command-studio-mock']")).toBeTruthy();

    await act(async () => root?.unmount());
    container.remove();
  });
});
