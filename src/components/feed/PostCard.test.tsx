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

const routerPushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// jsdom has no clipboard; the share test stubs it.
const clipboardWrite = vi.fn();

import { PostCard } from "./PostCard";
import type { PostDTO } from "./types";

function makePost(overrides: Partial<PostDTO> = {}): PostDTO {
  return {
    id: "post_1",
    author: { id: "user_1", username: "larry", displayName: "Larry", avatarUrl: null },
    content: "hello world",
    postType: "text",
    visibility: "public",
    mediaUrls: [],
    link: null,
    poll: null,
    projectRef: null,
    music: null,
    counts: { likes: 3, comments: 2, reposts: 1, saves: 0, shares: 4 },
    viewer: { liked: false, reaction: null, reposted: false, saved: false },
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe("PostCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerPushMock.mockReset();
    clerkAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: true, userId: "user_1" });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
    clipboardWrite.mockReset();
    // Avoid navigator.share so the copy-link path is deterministic.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });

  it("like click optimistically adds 1, then rolls back on a failed fetch", async () => {
    const onUpdate = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"));

    render(<PostCard post={makePost()} onUpdate={onUpdate} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Like" }));

    // Optimistic update first: likes 3 -> 4, liked = true.
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    const optimistic = onUpdate.mock.calls[0][0] as PostDTO;
    expect(optimistic.counts.likes).toBe(4);
    expect(optimistic.viewer.liked).toBe(true);

    // Failed fetch -> rollback restores the original post.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/posts/post_1/like", expect.objectContaining({ method: "POST" }));
    });
    const rollback = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as PostDTO;
    expect(rollback.counts.likes).toBe(3);
    expect(rollback.viewer.liked).toBe(false);
  });

  it("like persists the optimistic state when the fetch succeeds", async () => {
    const onUpdate = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ likes: 4 })),
    );

    render(<PostCard post={makePost()} onUpdate={onUpdate} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Like" }));

    await waitFor(() => {
      const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as PostDTO;
      expect(last.counts.likes).toBe(4);
      expect(last.viewer.liked).toBe(true);
    });
  });

  it("share copies the post link and records the share", async () => {
    const onUpdate = vi.fn();
    clipboardWrite.mockResolvedValueOnce(undefined);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ shares: 5 })));

    render(<PostCard post={makePost()} onUpdate={onUpdate} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("/post/post_1"));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/posts/post_1/share", { method: "POST" });
    });
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as PostDTO;
    expect(last.counts.shares).toBe(5);
  });

  it("delete flow asks for confirmation and calls onDelete on success", async () => {
    const onDelete = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));

    render(<PostCard post={makePost()} onUpdate={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog", { name: "Delete post" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("post_1");
    });
  });

  it("avatar links to the author's profile route", () => {
    render(<PostCard post={makePost()} onUpdate={vi.fn()} onDelete={vi.fn()} />);
    const links = screen.getAllByRole("link");
    const profileLinks = links.filter((l) => l.getAttribute("href") === "/u/larry");
    expect(profileLinks.length).toBeGreaterThan(0);
  });

  it("body click navigates to the post route", () => {
    render(<PostCard post={makePost()} onUpdate={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open post" }));
    expect(routerPushMock).toHaveBeenCalledWith("/post/post_1");
  });
});
