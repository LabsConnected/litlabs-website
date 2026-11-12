import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GalleryTool, {
  mergeBucketItems,
  type GalleryItem,
} from "./GalleryTool";

/**
 * Asset Bucket must show agent-generated media, not only manual
 * generations. Agent media tools write into the project workspace
 * (assets/images|video|audio) and never touch the localStorage history
 * keys the bucket used to read exclusively — so a Food-Court-style
 * agent build left the bucket at "0 items" while its images sat in the
 * project files. The bucket now also lists the active project's asset
 * folders via the project-files API, merged with the localStorage
 * entries (dedupe by URL/path; localStorage metadata wins).
 */

const PROJECT_ID = "proj-1";

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: new Proxy({}, { get: () => "#111111" }),
    tokens: new Proxy({}, { get: () => "#111111" }),
  }),
}));

vi.mock("../context/StudioContext", () => ({
  useStudioContext: () => ({ projectId: PROJECT_ID }),
  useStudioContextOptional: () => ({ projectId: PROJECT_ID }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// ─── Workspace listing fixture, keyed by directory path ──────────────
const wsDirs = vi.hoisted(() => ({
  map: new Map<string, Array<{ name: string; type: string }> | null>(),
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/gallery") return jsonResponse({ items: [] });
      const match = /\/files\?path=(.+)$/.exec(url);
      if (match) {
        const entries = wsDirs.map.get(decodeURIComponent(match[1]));
        if (!entries) return jsonResponse({ error: "Path not found" }, 404);
        return jsonResponse({ entries });
      }
      return jsonResponse({}, 404);
    }),
  );
}

function seedImageHistory(entries: unknown[]) {
  localStorage.setItem(
    "litlabs-studio-image-history",
    JSON.stringify(entries),
  );
}

const rawUrl = (path: string) =>
  `/api/studio-projects/${PROJECT_ID}/files/raw?path=${encodeURIComponent(path)}`;

function workspaceItem(path: string, kind: "image" | "video" | "audio"): GalleryItem {
  const url = rawUrl(path);
  return {
    id: `ws:${path}`,
    title: path.split("/").pop() ?? path,
    artist: "Project",
    category: kind,
    source: kind,
    imageUrl: kind === "image" ? url : undefined,
    videoUrl: kind === "video" ? url : undefined,
    audioUrl: kind === "audio" ? url : undefined,
    workspacePath: path,
    likes: 0,
    createdAt: "",
  };
}

beforeEach(() => {
  localStorage.clear();
  wsDirs.map.clear();
  wsDirs.map.set("assets/images", []);
  wsDirs.map.set("assets/video", null); // missing folder → 404, must be skipped quietly
  wsDirs.map.set("assets/audio", []);
  installFetchMock();
});

describe("GalleryTool — My Bucket workspace assets", () => {
  it("lists agent-generated workspace images for the active project", async () => {
    wsDirs.map.set("assets/images", [
      { name: "diverse-street-food-mwc386ys.jpeg", type: "file" },
      { name: "notes.txt", type: "file" }, // not media — must not appear
      { name: "nested", type: "folder" }, // folders are not bucket items
    ]);
    render(<GalleryTool />);

    expect(
      await screen.findByText("diverse-street-food-mwc386ys.jpeg"),
    ).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    // The bucket count includes the workspace file (was "My Bucket (0)").
    expect(
      screen.getByRole("button", { name: "My Bucket (1)" }),
    ).toBeInTheDocument();
  });

  it("still lists localStorage generations when the workspace has none", async () => {
    seedImageHistory([
      {
        id: "img-1",
        prompt: "A red barn at dusk",
        imageUrl: "https://cdn.example.com/barn.png",
        createdAt: Date.now(),
      },
    ]);
    render(<GalleryTool />);

    expect(await screen.findByText("A red barn at dusk")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "My Bucket (1)" }),
    ).toBeInTheDocument();
  });

  it("shows workspace items under the My Bucket tab", async () => {
    wsDirs.map.set("assets/images", [
      { name: "hero.png", type: "file" },
    ]);
    render(<GalleryTool />);
    fireEvent.click(await screen.findByRole("button", { name: "My Bucket (1)" }));
    expect(await screen.findByText("hero.png")).toBeInTheDocument();
  });

  it("dedupes a workspace file already in localStorage history, keeping localStorage metadata", async () => {
    seedImageHistory([
      {
        id: "img-cat",
        prompt: "Cat in a hat",
        imageUrl: rawUrl("assets/images/cat.jpg"),
        createdAt: Date.now(),
      },
    ]);
    wsDirs.map.set("assets/images", [{ name: "cat.jpg", type: "file" }]);
    render(<GalleryTool />);

    expect(await screen.findByText("Cat in a hat")).toBeInTheDocument();
    // One bucket entry, not two — and it is the localStorage one (its
    // prompt title), not the bare workspace filename.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "My Bucket (1)" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("cat.jpg")).not.toBeInTheDocument();
  });
});

describe("mergeBucketItems", () => {
  const localCat: GalleryItem = {
    id: "img-cat",
    title: "Cat in a hat",
    artist: "You",
    category: "image",
    source: "image",
    imageUrl: rawUrl("assets/images/cat.jpg"),
    likes: 0,
    createdAt: "2026-11-11",
  };

  it("drops a workspace item whose file the localStorage entry already references", () => {
    const merged = mergeBucketItems(
      [localCat],
      [workspaceItem("assets/images/cat.jpg", "image")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("img-cat");
    expect(merged[0].title).toBe("Cat in a hat");
  });

  it("keeps workspace items that have no localStorage counterpart", () => {
    const merged = mergeBucketItems(
      [localCat],
      [
        workspaceItem("assets/images/cat.jpg", "image"),
        workspaceItem("assets/images/dog.jpg", "image"),
      ],
    );
    expect(merged.map((i) => i.id)).toEqual(["img-cat", "ws:assets/images/dog.jpg"]);
  });

  it("returns workspace items untouched when history is empty", () => {
    const ws = [workspaceItem("assets/video/clip.mp4", "video")];
    expect(mergeBucketItems([], ws)).toEqual(ws);
  });

  it("does not dedupe a localStorage entry hosted elsewhere with the same filename", () => {
    const remote: GalleryItem = {
      ...localCat,
      id: "img-remote",
      imageUrl: "https://cdn.example.com/cat.jpg",
    };
    const merged = mergeBucketItems(
      [remote],
      [workspaceItem("assets/images/cat.jpg", "image")],
    );
    expect(merged).toHaveLength(2);
  });
});
