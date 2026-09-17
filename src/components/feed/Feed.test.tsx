import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKENS = {
  background: "#0a0a1a",
  surface: "#12122a",
  surfaceElevated: "#1a1a35",
  border: "#2a2a4a",
  text: "#eef",
  textMuted: "#999",
  textInverse: "#0a0a1a",
  primary: "#4f6cff",
  secondary: "#7c8cff",
  success: "#25e08a",
  warning: "#ffb020",
  danger: "#ef4444",
  focus: "#4f6cff",
};

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ tokens: TOKENS }),
}));

const clerkAuthMock = vi.fn();
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: (...args: unknown[]) => clerkAuthMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

import { Feed } from "./Feed";
import type { PostDTO } from "./types";

function makePost(id: string, content = "hello world"): PostDTO {
  return {
    id,
    author: { id: "user_1", username: "larry", displayName: "Larry", avatarUrl: null },
    content,
    postType: "text",
    visibility: "public",
    mediaUrls: [],
    link: null,
    poll: null,
    projectRef: null,
    music: null,
    counts: { likes: 0, comments: 0, reposts: 0, saves: 0, shares: 0 },
    viewer: { liked: false, reaction: null, reposted: false, saved: false },
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  };
}

describe("Feed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clerkAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: true, userId: "user_1" });
  });

  it("renders skeletons first, then the fetched posts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ posts: [makePost("p1")], nextCursor: null })),
      );

    render(<Feed />);
    expect(screen.getByLabelText("Loading feed")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("hello world")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("tab=for-you");
    expect(screen.queryByLabelText("Loading feed")).not.toBeInTheDocument();
  });

  it("tab switch refetches with the correct tab param and resets the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ posts: [makePost("p1", "for you post")], nextCursor: null })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ posts: [makePost("p2", "trending post")], nextCursor: null })),
      );

    render(<Feed />);
    await screen.findByText("for you post");

    fireEvent.click(screen.getByRole("tab", { name: /Trending/i }));

    await waitFor(() => {
      expect(screen.getByText("trending post")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("tab=trending");
    expect(screen.queryByText("for you post")).not.toBeInTheDocument();
  });

  it("dedupes posts across pages", async () => {
    const dup = makePost("p1");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ posts: [dup], nextCursor: "abc" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ posts: [makePost("p1", "hello world"), makePost("p2", "second")], nextCursor: null })),
      );

    render(<Feed />);
    await screen.findByText("hello world");
    // Trigger the load-more path via the sentinel fallback button (no IO in jsdom).
    const loadMore = await screen.findByRole("button", { name: /Load more/i }).catch(() => null);
    if (loadMore) fireEvent.click(loadMore);
    await waitFor(() => {
      expect(screen.getByText("second")).toBeInTheDocument();
    });
    const cards = screen.getAllByText("hello world");
    expect(cards.length).toBe(1);
  });

  it("shows ErrorState with Retry on fetch failure, and Retry refetches", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ posts: [makePost("p1")], nextCursor: null })),
      );

    render(<Feed />);
    await waitFor(() => {
      expect(screen.getByText("Feed unavailable")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => {
      expect(screen.getByText("hello world")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state with a sign-in CTA when signed out", async () => {
    clerkAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: false, userId: null });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ posts: [], nextCursor: null })),
    );

    render(<Feed />);
    await waitFor(() => {
      expect(screen.getByText("No posts yet")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /Sign in to post/i })).toBeInTheDocument();
  });
});
