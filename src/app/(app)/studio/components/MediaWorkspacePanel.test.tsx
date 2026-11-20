import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MediaWorkspacePanel } from "./CommandStudio";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/studio",
}));

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
  { id: "generation_job:img-1", kind: "image", source: "generated", name: "hero.png", url: "https://x/hero.png", visibility: "private", createdAt: "2026-11-17T00:00:00Z" },
  { id: "user_media:vid-1", kind: "video", source: "uploaded", name: "tour.mp4", url: "https://x/tour.mp4", visibility: "private", createdAt: "2026-11-17T00:00:00Z" },
];

/**
 * Stateful fake Asset Lake, mirroring BoardMediaPanel.test.tsx: DELETE
 * really removes the row, so a refetch after delete proves the item is
 * gone from the underlying list — not just hidden locally.
 */
function stubServer(initial: FakeAsset[] = baseAssets) {
  let lake = [...initial];
  const calls: Array<{ url: string; method: string }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.startsWith("/api/assets") && method === "GET") {
      return { ok: true, json: async () => ({ assets: lake, count: lake.length }) };
    }
    if (url.startsWith("/api/assets/") && method === "DELETE") {
      const id = decodeURIComponent(url.slice("/api/assets/".length).split("?")[0]);
      const before = lake.length;
      lake = lake.filter((a) => a.id !== id);
      return { ok: lake.length < before, json: async () => ({ success: lake.length < before }) };
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MediaWorkspacePanel (classic layout) — real assets scope", () => {
  it("fetches the project scope (same query as the board panel) and renders the items", async () => {
    const server = stubServer();
    render(<MediaWorkspacePanel projectId="project-1" onOpenCreate={() => undefined} />);

    const imageTile = await screen.findByTestId("classic-media-asset-generation_job:img-1");
    expect(imageTile).toHaveTextContent("hero.png");
    expect(imageTile).toHaveTextContent("Image");
    const videoTile = screen.getByTestId("classic-media-asset-user_media:vid-1");
    expect(videoTile).toHaveTextContent("tour.mp4");
    expect(videoTile).toHaveTextContent("Video");

    // The read is the board panel's exact query: projectId + scope=project.
    const getCall = server.calls.find((c) => c.method === "GET");
    expect(getCall?.url).toContain("projectId=project-1");
    expect(getCall?.url).toContain("scope=project");

    // A populated project must never show the placeholder's empty claim.
    expect(screen.queryByText("No media artifacts yet")).not.toBeInTheDocument();
  });

  it("shows the empty line ONLY when the project scope is genuinely empty", async () => {
    stubServer([]);
    render(<MediaWorkspacePanel projectId="project-1" onOpenCreate={() => undefined} />);

    expect(await screen.findByTestId("classic-media-empty")).toBeInTheDocument();
    expect(screen.getByText("No media artifacts yet")).toBeInTheDocument();
    expect(screen.queryByTestId("classic-media-error")).not.toBeInTheDocument();
  });

  it("shows the real error on a failed fetch — never a fake empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "Asset lake unavailable" }),
      })),
    );
    render(<MediaWorkspacePanel projectId="project-1" onOpenCreate={() => undefined} />);

    expect(await screen.findByTestId("classic-media-error")).toHaveTextContent(
      "Asset lake unavailable",
    );
    expect(screen.queryByText("No media artifacts yet")).not.toBeInTheDocument();
    expect(screen.getByTestId("classic-media-retry")).toBeInTheDocument();
  });

  it("shows a loading state while the first fetch is in flight", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    render(<MediaWorkspacePanel projectId="project-1" onOpenCreate={() => undefined} />);

    expect(await screen.findByTestId("classic-media-loading")).toBeInTheDocument();
    expect(screen.queryByText("No media artifacts yet")).not.toBeInTheDocument();

    resolveFetch?.({ ok: true, json: async () => ({ assets: [], count: 0 }) });
    expect(await screen.findByTestId("classic-media-empty")).toBeInTheDocument();
  });

  it("selecting an item shows its detail; delete confirms, calls the real endpoint, and the item is gone after refetch", async () => {
    const server = stubServer();
    render(<MediaWorkspacePanel projectId="project-1" onOpenCreate={() => undefined} />);

    fireEvent.click(await screen.findByTestId("classic-media-asset-generation_job:img-1"));
    expect(screen.getByTestId("classic-media-detail")).toBeInTheDocument();

    // First click only arms the confirmation — nothing is deleted yet.
    fireEvent.click(screen.getByTestId("classic-media-action-delete"));
    expect(server.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByText("Delete this item permanently?")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("classic-media-action-delete-confirm"));
    await waitFor(() => {
      expect(server.calls.some((c) => c.method === "DELETE")).toBe(true);
    });
    const deleteCall = server.calls.find((c) => c.method === "DELETE");
    expect(deleteCall?.url).toContain("/api/assets/generation_job%3Aimg-1");
    expect(deleteCall?.url).toContain("projectId=project-1");

    // After the post-delete refetch the item is gone from the list and
    // the detail view is closed.
    await waitFor(() => {
      expect(
        screen.queryByTestId("classic-media-asset-generation_job:img-1"),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("classic-media-detail")).not.toBeInTheDocument();
    expect(screen.getByTestId("classic-media-asset-user_media:vid-1")).toBeInTheDocument();
  });
});
