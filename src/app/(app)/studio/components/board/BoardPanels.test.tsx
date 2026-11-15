import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardChatPanel from "./BoardChatPanel";
import BoardMediaPanel from "./BoardMediaPanel";
import BoardBrowserPanel, { normalizeBrowserUrl } from "./BoardBrowserPanel";
import { useExecutionStore, type ExecutionEvent } from "../../stores/useExecutionStore";

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function executionEvent(id: string, summary: string): ExecutionEvent {
  return { id, seq: Number(id.replace(/\D/g, "")) || 1, type: "tool_result", summary } as ExecutionEvent;
}

beforeEach(() => {
  useExecutionStore.setState({ phase: "idle", isRunning: false, events: [], checkpoint: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BoardChatPanel (Command Center)", () => {
  const chatProps = {
    projectName: "Test Project",
    transcript: <div data-testid="transcript-stub" />,
    composer: <div data-testid="composer-stub" />,
    onNewChat: vi.fn(),
    onOpenPreview: vi.fn(),
    onOpenFiles: vi.fn(),
  };

  it("lands straight in the conversation with Chat / Files tabs and New Chat inside the panel", () => {
    wrap(<BoardChatPanel {...chatProps} />);
    expect(screen.getByTestId("board-chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("board-chat-tab-chat")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("board-chat-tab-files")).toBeInTheDocument();
    // Activity is NOT a chat tab — it is its own board panel.
    expect(screen.queryByRole("tab", { name: /activity/i })).toBeNull();
    expect(screen.getByTestId("transcript-stub")).toBeInTheDocument();
    expect(screen.getByTestId("composer-stub")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("board-chat-new-chat"));
    expect(chatProps.onNewChat).toHaveBeenCalled();
  });

  it("the Files tab points at the single Files panel instead of mounting a second tree", () => {
    wrap(<BoardChatPanel {...chatProps} />);
    fireEvent.click(screen.getByTestId("board-chat-tab-files"));
    expect(screen.queryByTestId("transcript-stub")).toBeNull();
    fireEvent.click(screen.getByTestId("board-chat-open-files"));
    expect(chatProps.onOpenFiles).toHaveBeenCalled();
  });

  it("shows the run's plan as a green-check list and the Site ready card when a run finishes", () => {
    useExecutionStore.setState({
      phase: "done",
      isRunning: false,
      events: [executionEvent("e1", "Design landing page"), executionEvent("e2", "Build hero section")],
      checkpoint: { label: "Landing page build", gitSha: "abc123" },
    });
    wrap(<BoardChatPanel {...chatProps} />);
    const plan = screen.getByTestId("board-chat-plan");
    expect(plan).toHaveTextContent("Design landing page");
    expect(plan).toHaveTextContent("Build hero section");
    const card = screen.getByTestId("board-chat-result-card");
    expect(card).toHaveTextContent("Test Project — Site ready!");
    expect(card).toHaveTextContent("Landing page build");
    fireEvent.click(screen.getByTestId("board-chat-result-preview"));
    expect(chatProps.onOpenPreview).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("board-chat-result-files"));
    expect(chatProps.onOpenFiles).toHaveBeenCalled();
  });

  it("Try next rows prime the composer through studio:ask-litt — nothing sends itself", () => {
    useExecutionStore.setState({
      phase: "done",
      isRunning: false,
      events: [executionEvent("e1", "Build hero section")],
      checkpoint: null,
    });
    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail?.prompt ?? "");
    window.addEventListener("studio:ask-litt", listener);
    wrap(<BoardChatPanel {...chatProps} />);
    fireEvent.click(screen.getByTestId("board-chat-try-next-Add a pricing section"));
    window.removeEventListener("studio:ask-litt", listener);
    expect(seen).toEqual(["Add a pricing section"]);
  });

  it("no result card while a run is still going or before any run", () => {
    wrap(<BoardChatPanel {...chatProps} />);
    expect(screen.queryByTestId("board-chat-result-card")).toBeNull();
    useExecutionStore.setState({ phase: "editing", isRunning: true, events: [executionEvent("e1", "Working")] });
    expect(screen.queryByTestId("board-chat-result-card")).toBeNull();
  });

  it("before any run, the first action is stated plainly (Finish Spec)", () => {
    wrap(<BoardChatPanel {...chatProps} />);
    expect(screen.getByTestId("board-chat-first-action")).toHaveTextContent(
      "Describe what you want to build",
    );
  });

  it("during a run, progress names the current step and the first-action hint is gone", () => {
    useExecutionStore.setState({
      phase: "editing",
      isRunning: true,
      events: [executionEvent("e1", "Build hero section")],
      checkpoint: null,
    });
    wrap(<BoardChatPanel {...chatProps} />);
    expect(screen.getByTestId("board-chat-progress")).toHaveTextContent("Building — Build hero section");
    expect(screen.queryByTestId("board-chat-first-action")).toBeNull();
  });

  it("the finished card offers Preview, Review changes and Undo (Finish Spec)", () => {
    useExecutionStore.setState({
      phase: "done",
      isRunning: false,
      events: [executionEvent("e1", "Build hero section")],
      checkpoint: { label: "Landing page build", gitSha: "abc123" },
    });
    const onUndo = vi.fn();
    const onReviewChanges = vi.fn();
    wrap(<BoardChatPanel {...chatProps} onUndo={onUndo} onReviewChanges={onReviewChanges} />);
    fireEvent.click(screen.getByTestId("board-chat-result-review"));
    expect(onReviewChanges).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("board-chat-result-undo"));
    expect(onUndo).toHaveBeenCalled();
  });
});

describe("BoardMediaPanel (unified Media)", () => {
  const assets = [
    { id: "a1", kind: "image", source: "generated", name: "hero.png", url: "https://x/hero.png", thumbnailUrl: "https://x/hero-t.png", visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
    { id: "a2", kind: "video", source: "uploaded", name: "tour.mp4", url: "https://x/tour.mp4", visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
    { id: "a3", kind: "music", source: "generated", name: "theme.mp3", url: "https://x/theme.mp3", visibility: "private", createdAt: "2026-11-14T00:00:00Z" },
  ];

  function stubFetch(generateResult?: unknown) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/assets")) {
        return { ok: true, json: async () => ({ assets, count: assets.length }) };
      }
      if (url.startsWith("/api/media/generate")) {
        return { ok: true, json: async () => generateResult ?? { success: true, assetId: "a1", downloadUrl: "https://x/new.png" } };
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? ""}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("splits the Asset Lake into Images / Video / Music tabs with thumbnails", async () => {
    stubFetch();
    wrap(<BoardMediaPanel projectId="project-1" />);
    expect(await screen.findByTestId("board-media-asset-a1")).toBeInTheDocument();
    expect(screen.queryByTestId("board-media-asset-a2")).toBeNull();
    fireEvent.click(screen.getByTestId("board-media-tab-video"));
    expect(await screen.findByTestId("board-media-asset-a2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("board-media-tab-music"));
    expect(await screen.findByTestId("board-media-asset-a3")).toBeInTheDocument();
  });

  it("selecting an asset opens it in the viewer", async () => {
    stubFetch();
    wrap(<BoardMediaPanel projectId="project-1" />);
    fireEvent.click(await screen.findByTestId("board-media-asset-a1"));
    const viewer = screen.getByTestId("board-media-viewer");
    expect(viewer).toHaveTextContent("hero.png");
  });

  it("the asset composer generates through /api/media/generate and announces the new asset", async () => {
    const fetchMock = stubFetch();
    wrap(<BoardMediaPanel projectId="project-1" />);
    await screen.findByTestId("board-media-asset-a1");
    fireEvent.change(screen.getByTestId("board-media-composer-input"), {
      target: { value: "a sunny rooftop" },
    });
    fireEvent.click(screen.getByTestId("board-media-composer-send"));
    await waitFor(() => {
      const generateCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/media/generate"));
      expect(generateCall).toBeDefined();
      const body = JSON.parse(String((generateCall?.[1] as RequestInit)?.body));
      expect(body.prompt).toBe("a sunny rooftop");
      expect(body.generationMode).toBe("auto-free");
      expect(body.projectId).toBe("project-1");
    });
  });
});

describe("BoardBrowserPanel", () => {
  it("normalizes typed addresses", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com");
    expect(normalizeBrowserUrl("http://a.b/c")).toBe("http://a.b/c");
    expect(normalizeBrowserUrl("  ")).toBeNull();
  });

  it("navigates the embedded frame and tracks local history", () => {
    wrap(<BoardBrowserPanel />);
    expect(screen.queryByTestId("board-browser-frame")).toBeNull();
    fireEvent.change(screen.getByTestId("board-browser-input"), { target: { value: "example.com" } });
    fireEvent.keyDown(screen.getByTestId("board-browser-input"), { key: "Enter" });
    const frame = screen.getByTestId("board-browser-frame");
    expect(frame).toHaveAttribute("src", "https://example.com");
    expect(screen.getByTestId("board-browser-open")).toHaveAttribute("href", "https://example.com");
  });
});
