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

import { Composer } from "./Composer";
import type { PostDTO } from "./types";

function makePost(content = "test"): PostDTO {
  return {
    id: "post_new",
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Composer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clerkAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: true, userId: "user_1" });
  });

  it("post button is disabled while the textarea is empty", () => {
    render(<Composer onPosted={vi.fn()} />);
    const postBtn = screen.getByRole("button", { name: "Publish post" });
    expect(postBtn).toBeDisabled();
  });

  it("post button enables with text and calls onPosted only after response.ok", async () => {
    const onPosted = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ post: makePost("draft saved") })));

    render(<Composer onPosted={onPosted} />);
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "draft saved" } });

    const postBtn = screen.getByRole("button", { name: "Publish post" });
    expect(postBtn).toBeEnabled();
    fireEvent.click(postBtn);

    expect(onPosted).not.toHaveBeenCalled(); // nothing claimed before the response
    await waitFor(() => {
      expect(onPosted).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/posts",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.content).toBe("draft saved");
    expect(body.postType).toBe("text");
    expect(body.visibility).toBe("public");
    // Draft cleared after success.
    expect(screen.getByLabelText("Post text")).toHaveValue("");
  });

  it("keeps the draft and shows Retry on a failed post", async () => {
    const onPosted = vi.fn();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    render(<Composer onPosted={onPosted} />);
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "my precious draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish post" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
    expect(onPosted).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Post text")).toHaveValue("my precious draft");
  });

  it("poll type requires at least two filled options before posting", async () => {
    const onPosted = vi.fn();
    render(<Composer onPosted={onPosted} />);

    fireEvent.click(screen.getByRole("tab", { name: "Poll" }));
    fireEvent.change(screen.getByLabelText("Poll question"), { target: { value: "best color?" } });
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "vote!" } });

    // Only one option filled -> still invalid.
    fireEvent.change(screen.getByLabelText("Poll option 1"), { target: { value: "blue" } });
    expect(screen.getByRole("button", { name: "Publish post" })).toBeDisabled();

    // Two options filled -> valid.
    fireEvent.change(screen.getByLabelText("Poll option 2"), { target: { value: "purple" } });
    const postBtn = screen.getByRole("button", { name: "Publish post" });
    expect(postBtn).toBeEnabled();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ post: makePost("vote!") })),
    );
    fireEvent.click(postBtn);
    await waitFor(() => {
      expect(onPosted).toHaveBeenCalledTimes(1);
    });
  });

  it("signed-out users see a sign-in CTA instead of the composer", () => {
    clerkAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: false, userId: null });
    render(<Composer onPosted={vi.fn()} />);
    expect(screen.getByText("Join the conversation")).toBeInTheDocument();
    expect(screen.queryByLabelText("Post text")).not.toBeInTheDocument();
  });

  it("post button enables with text + a not-yet-uploaded image (upload runs at submit)", async () => {
    // Regression: hasAttachment() required f.uploadedUrl, but files only
    // upload inside submit() — so the Post button stayed disabled forever
    // once an image was attached. Posting with media was 100% broken.
    const onPosted = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://cdn/x.png" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ post: makePost("with pic") })));

    render(<Composer onPosted={onPosted} />);
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "with pic" } });
    fireEvent.change(screen.getByLabelText("Choose image files"), {
      target: { files: [new File(["img"], "pic.png", { type: "image/png" })] },
    });

    const postBtn = screen.getByRole("button", { name: "Publish post" });
    expect(postBtn).toBeEnabled();

    fireEvent.click(postBtn);
    await waitFor(() => {
      expect(onPosted).toHaveBeenCalledTimes(1);
    });
    // Upload ran first, then the post went out with the uploaded URL.
    expect(fetchMock.mock.calls[0][0]).toBe("/api/upload");
    const body = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(body.mediaUrls).toEqual(["https://cdn/x.png"]);
  });

  it("post button disables after the attached image fails to upload", async () => {
    const onPosted = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    render(<Composer onPosted={onPosted} />);
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "with pic" } });
    fireEvent.change(screen.getByLabelText("Choose image files"), {
      target: { files: [new File(["img"], "pic.png", { type: "image/png" })] },
    });

    const postBtn = screen.getByRole("button", { name: "Publish post" });
    expect(postBtn).toBeEnabled();
    fireEvent.click(postBtn);

    // Upload failed: the file is now in error state, so the button must
    // disable until the user retries or removes the file.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Publish post" })).toBeDisabled();
    });
    expect(onPosted).not.toHaveBeenCalled();
    expect(screen.getByText(/failed to upload/i)).toBeInTheDocument();
  });
});
