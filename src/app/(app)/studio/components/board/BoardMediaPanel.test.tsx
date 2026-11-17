import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardMediaPanel from "./BoardMediaPanel";

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

interface FakeAsset {
  id: string;
  kind: string;
  source: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
  visibility: string;
  createdAt: string;
}

const baseAssets: FakeAsset[] = [
  { id: "generation_job:img-1", kind: "image", source: "generated", name: "hero.png", url: "https://x/hero.png", visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
  { id: "user_media:vid-1", kind: "video", source: "uploaded", name: "tour.mp4", url: "https://x/tour.mp4", visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
  { id: "music_track:trk-1", kind: "music", source: "generated", name: "theme.mp3", url: "https://x/theme.mp3", visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
];

/**
 * Stateful fake server: DELETE really removes the row from the fake
 * lake, so a panel refetch after delete proves the item is gone from
 * the underlying list — not just hidden locally.
 */
function stubServer(initial: FakeAsset[] = baseAssets) {
  let lake = [...initial];
  let genCounter = 0;
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, body });
    if (url.startsWith("/api/assets") && method === "GET") {
      return { ok: true, json: async () => ({ assets: lake, count: lake.length }) };
    }
    if (url.startsWith("/api/assets/") && method === "DELETE") {
      const id = decodeURIComponent(url.slice("/api/assets/".length).split("?")[0]);
      const before = lake.length;
      lake = lake.filter((a) => a.id !== id);
      return { ok: lake.length < before, json: async () => ({ success: lake.length < before }) };
    }
    if (url.startsWith("/api/media/generate")) {
      genCounter += 1;
      const assetId = `generation_job:gen-${genCounter}`;
      const urlOut = `https://x/gen-${genCounter}.png`;
      lake = [
        ...lake,
        { id: assetId, kind: "image", source: "generated", name: `gen-${genCounter}.png`, url: urlOut, visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
      ];
      return { ok: true, json: async () => ({ success: true, assetId, downloadUrl: urlOut }) };
    }
    if (url.startsWith("/api/media/edit-image")) {
      const assetId = "generation_job:edited-1";
      lake = [
        ...lake,
        { id: assetId, kind: "image", source: "generated", name: "edited.png", url: "https://x/edited.png", visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
      ];
      return { ok: true, json: async () => ({ success: true, assetId, downloadUrl: "https://x/edited.png" }) };
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls, lake: () => lake };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BoardMediaPanel click-to-manage (Amendment 6)", () => {
  it("selecting an item exposes Delete and Edit actions", async () => {
    stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    fireEvent.click(await screen.findByTestId("board-media-asset-generation_job:img-1"));
    expect(screen.getByTestId("board-media-action-delete")).toBeInTheDocument();
    expect(screen.getByTestId("board-media-action-edit")).toBeInTheDocument();
  });

  it("delete asks for confirmation, calls the real delete endpoint, and the item is gone after refetch", async () => {
    const server = stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    fireEvent.click(await screen.findByTestId("board-media-asset-generation_job:img-1"));
    fireEvent.click(screen.getByTestId("board-media-action-delete"));
    // Confirm step appears; nothing deleted yet.
    expect(screen.getByTestId("board-media-action-delete-confirm")).toBeInTheDocument();
    expect(server.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByTestId("board-media-action-delete-confirm"));
    await waitFor(() => {
      const del = server.calls.find((c) => c.method === "DELETE");
      expect(del?.url).toContain(`/api/assets/${encodeURIComponent("generation_job:img-1")}`);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("board-media-asset-generation_job:img-1")).toBeNull();
    });
    expect(server.lake().some((a) => a.id === "generation_job:img-1")).toBe(false);
  });

  it("delete can be cancelled at the confirm step", async () => {
    const server = stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    fireEvent.click(await screen.findByTestId("board-media-asset-generation_job:img-1"));
    fireEvent.click(screen.getByTestId("board-media-action-delete"));
    fireEvent.click(screen.getByTestId("board-media-action-delete-cancel"));
    expect(screen.getByTestId("board-media-action-delete")).toBeInTheDocument();
    expect(server.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("video and music items expose Delete too", async () => {
    stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    await screen.findByTestId("board-media-asset-generation_job:img-1");
    fireEvent.click(screen.getByTestId("board-media-tab-video"));
    fireEvent.click(await screen.findByTestId("board-media-asset-user_media:vid-1"));
    expect(screen.getByTestId("board-media-action-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("board-media-action-edit")).toBeNull();
    fireEvent.click(screen.getByTestId("board-media-tab-music"));
    fireEvent.click(await screen.findByTestId("board-media-asset-music_track:trk-1"));
    expect(screen.getByTestId("board-media-action-delete")).toBeInTheDocument();
  });

  it("edit opens a prompt inside the panel and submits through /api/media/edit-image with the source image", async () => {
    const server = stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    fireEvent.click(await screen.findByTestId("board-media-asset-generation_job:img-1"));
    fireEvent.click(screen.getByTestId("board-media-action-edit"));
    fireEvent.change(screen.getByTestId("board-media-edit-input"), {
      target: { value: "make it sunset" },
    });
    fireEvent.click(screen.getByTestId("board-media-edit-submit"));
    await waitFor(() => {
      const edit = server.calls.find((c) => c.url.startsWith("/api/media/edit-image"));
      expect(edit?.body).toMatchObject({
        imageUrl: "https://x/hero.png",
        prompt: "make it sunset",
        projectId: "project-1",
      });
    });
    // The edited image lands in Media and is selected.
    expect(await screen.findByTestId("board-media-asset-generation_job:edited-1")).toBeInTheDocument();
  });
});

describe("BoardMediaPanel generation set (Amendment 7)", () => {
  it("style choices are shown up front, before generating", async () => {
    stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    await screen.findByTestId("board-media-asset-generation_job:img-1");
    for (const id of ["none", "3d-render", "cartoon", "pixel-art", "watercolor", "cinematic-photo"]) {
      expect(screen.getByTestId(`board-media-style-${id}`)).toBeInTheDocument();
    }
  });

  it("generating produces a set of 4 options, with the chosen style folded into every request", async () => {
    const server = stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    await screen.findByTestId("board-media-asset-generation_job:img-1");
    fireEvent.click(screen.getByTestId("board-media-style-watercolor"));
    fireEvent.change(screen.getByTestId("board-media-composer-input"), {
      target: { value: "a lighthouse" },
    });
    fireEvent.click(screen.getByTestId("board-media-composer-send"));
    expect(await screen.findByTestId("board-media-candidate-0")).toBeInTheDocument();
    expect(screen.getByTestId("board-media-candidate-3")).toBeInTheDocument();
    const genCalls = server.calls.filter((c) => c.url.startsWith("/api/media/generate"));
    expect(genCalls).toHaveLength(4);
    for (const call of genCalls) {
      expect(call.body?.prompt).toBe("a lighthouse, watercolor painting");
    }
    const seeds = genCalls.map((c) => c.body?.seed);
    expect(new Set(seeds).size).toBe(4);
  });

  it("refresh discards the current set through the delete endpoint and generates a different set", async () => {
    const server = stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    await screen.findByTestId("board-media-asset-generation_job:img-1");
    fireEvent.change(screen.getByTestId("board-media-composer-input"), {
      target: { value: "a lighthouse" },
    });
    fireEvent.click(screen.getByTestId("board-media-composer-send"));
    expect(await screen.findByTestId("board-media-candidate-0")).toBeInTheDocument();
    const firstSetIds = server.lake().filter((a) => a.id.startsWith("generation_job:gen-")).map((a) => a.id);
    expect(firstSetIds).toHaveLength(4);
    fireEvent.click(screen.getByTestId("board-media-candidates-refresh"));
    await waitFor(() => {
      const genCalls = server.calls.filter((c) => c.url.startsWith("/api/media/generate"));
      expect(genCalls).toHaveLength(8);
    });
    await waitFor(() => {
      for (const id of firstSetIds) {
        expect(server.lake().some((a) => a.id === id)).toBe(false);
      }
    });
    expect(screen.getByTestId("board-media-candidate-0")).toBeInTheDocument();
  });

  it("picking a candidate keeps it in Media and deletes the unpicked options", async () => {
    const server = stubServer();
    wrap(<BoardMediaPanel projectId="project-1" />);
    await screen.findByTestId("board-media-asset-generation_job:img-1");
    fireEvent.change(screen.getByTestId("board-media-composer-input"), {
      target: { value: "a lighthouse" },
    });
    fireEvent.click(screen.getByTestId("board-media-composer-send"));
    expect(await screen.findByTestId("board-media-candidate-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("board-media-candidate-keep-1"));
    await waitFor(() => {
      expect(screen.queryByTestId("board-media-candidates")).toBeNull();
    });
    await waitFor(() => {
      const kept = server.lake().filter((a) => a.id.startsWith("generation_job:gen-"));
      expect(kept).toHaveLength(1);
      expect(kept[0].id).toBe("generation_job:gen-2");
    });
    // The kept image is a normal Media item: rendered and selected.
    expect(await screen.findByTestId("board-media-asset-generation_job:gen-2")).toBeInTheDocument();
    expect(screen.getByTestId("board-media-viewer")).toBeInTheDocument();
  });
});
