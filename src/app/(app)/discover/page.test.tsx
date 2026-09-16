import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authState: { isLoaded: true, isSignedIn: true },
  composerOnPosted: null as ((post: unknown) => void) | null,
  prependSpy: vi.fn(),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => mocks.authState,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#0a0a12",
      surface: "#151520",
      surfaceElevated: "#1e1e2e",
      border: "#2a2a45",
      text: "#e0e0ff",
      textMuted: "#8888aa",
      textInverse: "#0a0a12",
      primary: "#00f0ff",
      secondary: "#7b61ff",
      success: "#00ff41",
      warning: "#ffff00",
      danger: "#ff5470",
      focus: "#00f0ff",
    },
  }),
}));

vi.mock("@/components/feed/Composer", () => ({
  Composer: (props: { onPosted: (post: unknown) => void }) => {
    mocks.composerOnPosted = props.onPosted;
    return <div data-testid="composer" />;
  },
}));

vi.mock("@/components/feed/Feed", () => ({
  // Emulates the real Feed's imperative prependPost handle so the page's
  // Composer → Feed wiring is testable at the page level.
  Feed: (props: {
    initialTab?: string;
    ref?: { current: { prependPost: (post: unknown) => void } | null };
  }) => {
    if (props.ref) {
      props.ref.current = { prependPost: mocks.prependSpy };
    }
    return <div data-testid="feed" data-initial-tab={props.initialTab} />;
  },
}));

vi.mock("@/components/SocialPageContent", () => ({
  default: () => <div data-testid="legacy-social-page-content" />,
}));

import DiscoverPage from "./page";

describe("DiscoverPage", () => {
  beforeEach(() => {
    mocks.authState.isLoaded = true;
    mocks.authState.isSignedIn = true;
    mocks.composerOnPosted = null;
    mocks.prependSpy.mockReset();
    vi.useRealTimers();
  });

  it("renders the composer and feed for signed-in users", () => {
    render(<DiscoverPage />);
    expect(screen.getByTestId("composer")).toBeInTheDocument();
    const feed = screen.getByTestId("feed");
    expect(feed).toBeInTheDocument();
    expect(feed).toHaveAttribute("data-initial-tab", "for-you");
  });

  it("does not render the legacy SocialPageContent", () => {
    render(<DiscoverPage />);
    expect(
      screen.queryByTestId("legacy-social-page-content"),
    ).not.toBeInTheDocument();
  });

  it("prepends a newly posted item into the feed instantly", () => {
    render(<DiscoverPage />);
    const post = { id: "post_1", content: "hello world" };
    act(() => {
      mocks.composerOnPosted?.(post);
    });
    expect(mocks.prependSpy).toHaveBeenCalledTimes(1);
    expect(mocks.prependSpy).toHaveBeenCalledWith(post);
  });

  it("shows a slim sign-in CTA instead of the composer when signed out", () => {
    mocks.authState.isSignedIn = false;
    render(<DiscoverPage />);
    expect(screen.queryByTestId("composer")).not.toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /sign in/i });
    expect(cta).toHaveAttribute("href", "/sign-in?redirect_url=/discover");
    // The feed itself stays visible to signed-out visitors.
    expect(screen.getByTestId("feed")).toBeInTheDocument();
  });

  it("offers a retry after the auth load timeout", () => {
    mocks.authState.isLoaded = false;
    vi.useFakeTimers();
    render(<DiscoverPage />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(
      screen.getByRole("button", { name: /retry/i }),
    ).toBeInTheDocument();
  });
});
