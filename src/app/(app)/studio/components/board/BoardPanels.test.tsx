import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no PointerEvent constructor; fireEvent falls back to a
// generic Event that drops clientX/pointerId, which the drag sessions
// read. A MouseEvent-based stub carries both (test scaffolding only).
class PointerEventStub extends MouseEvent {
  pointerId: number;
  constructor(type: string, params: PointerEventInit & MouseEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
  }
}
globalThis.PointerEvent = PointerEventStub as typeof PointerEvent;
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardChatPanel from "./BoardChatPanel";
import BoardPanel from "./BoardPanel";
import BoardMediaPanel from "./BoardMediaPanel";

// The Jobs tab mounts these three real feeds; stub them here so this
// suite pins BoardChatPanel's WIRING (which feed, which props) — each
// feed's own internals are covered by its own suite.
vi.mock("../StudioHealthPanel", () => ({
  default: (props: { mode: string; projectId: string | null; conversationId?: string | null }) => (
    <div
      data-testid="jobs-approvals-stub"
      data-mode={props.mode}
      data-project={props.projectId ?? ""}
      data-conversation={props.conversationId ?? ""}
    />
  ),
}));
vi.mock("../RunChangesPanel", () => ({
  default: (props: { projectId: string | null }) => (
    <div data-testid="jobs-changes-stub" data-project={props.projectId ?? ""} />
  ),
}));
vi.mock("../ActionRunStatusPanel", () => ({
  ActionRunStatusPanel: (props: { conversationId: string }) => (
    <div data-testid="jobs-live-steps-stub" data-conversation={props.conversationId} />
  ),
}));
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

  it("lands straight in the conversation with Chat / Jobs tabs and New Chat inside the panel", () => {
    wrap(<BoardChatPanel {...chatProps} />);
    expect(screen.getByTestId("board-chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("board-chat-tab-chat")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("board-chat-tab-jobs")).toBeInTheDocument();
    // The Files tab is GONE entirely (Amendments 1+3) — no tab, no pointer content.
    expect(screen.queryByTestId("board-chat-tab-files")).toBeNull();
    expect(screen.queryByRole("tab", { name: /files/i })).toBeNull();
    expect(screen.queryByTestId("board-chat-open-files")).toBeNull();
    // Activity is NOT a chat tab — it is its own board panel.
    expect(screen.queryByRole("tab", { name: /activity/i })).toBeNull();
    expect(screen.getByTestId("transcript-stub")).toBeInTheDocument();
    expect(screen.getByTestId("composer-stub")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("board-chat-new-chat"));
    expect(chatProps.onNewChat).toHaveBeenCalled();
  });

  it("the tab bar's empty space drags the whole panel inside BoardPanel; tabs and New Chat still work", () => {
    const onRectChange = vi.fn();
    const onNewChat = vi.fn();
    wrap(
      <BoardPanel
        id="chat"
        title="Chat"
        rect={{ x: 100, y: 80, width: 400, height: 300 }}
        zIndex={3}
        maximized={false}
        onRectChange={onRectChange}
        onBringToFront={vi.fn()}
        onMinimize={vi.fn()}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
      >
        <BoardChatPanel {...chatProps} onNewChat={onNewChat} />
      </BoardPanel>,
    );
    // The empty spacer between the tab list and + New Chat is the grab
    // point users actually land on — it must move the whole panel.
    const newChatButton = screen.getByTestId("board-chat-new-chat");
    const spacer = newChatButton.previousElementSibling as HTMLElement;
    expect(spacer).not.toBeNull();
    fireEvent.pointerDown(spacer, { pointerId: 31, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 31, clientX: 340, clientY: 130 });
    expect(onRectChange).toHaveBeenCalledWith("chat", {
      x: 140,
      y: 110,
      width: 400,
      height: 300,
    });
    fireEvent.pointerUp(window, { pointerId: 31, clientX: 340, clientY: 130 });
    // The tabs inside the same strip keep their own behavior.
    fireEvent.click(screen.getByTestId("board-chat-tab-jobs"));
    expect(screen.getByTestId("board-chat-jobs")).toBeInTheDocument();
    fireEvent.click(newChatButton);
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("the Jobs tab holds the plan, work log and checks summary from real store state — the Chat tab stays conversation-only", () => {
    useExecutionStore.setState({
      phase: "editing",
      isRunning: true,
      events: [
        executionEvent("e1", "Design landing page"),
        executionEvent("e2", "Build hero section"),
        {
          id: "e3",
          seq: 3,
          type: "build_result",
          summary: "Typecheck finished",
          check: "typecheck",
          success: false,
          errorCount: 2,
        } as ExecutionEvent,
      ],
      checkpoint: null,
    });
    wrap(<BoardChatPanel {...chatProps} />);
    // None of the run machinery is in the conversation anymore.
    expect(screen.queryByTestId("board-chat-jobs-plan")).toBeNull();
    expect(screen.queryByText("Design landing page")).toBeNull();
    fireEvent.click(screen.getByTestId("board-chat-tab-jobs"));
    expect(screen.queryByTestId("transcript-stub")).toBeNull();
    const plan = screen.getByTestId("board-chat-jobs-plan");
    expect(plan).toHaveTextContent("Design landing page");
    expect(plan).toHaveTextContent("Build hero section");
    const worklog = screen.getByTestId("board-chat-jobs-worklog");
    expect(worklog).toHaveTextContent("Design landing page");
    expect(worklog).toHaveTextContent("Typecheck finished");
    const checks = screen.getByTestId("board-chat-jobs-checks");
    expect(checks).toHaveTextContent("typecheck");
    expect(checks).toHaveTextContent("2 errors");
    // New Chat stays visible and reachable from the Jobs tab chrome too.
    fireEvent.click(screen.getByTestId("board-chat-new-chat"));
    expect(chatProps.onNewChat).toHaveBeenCalled();
  });

  it("Jobs shows honest empty states when no run, project or conversation is in scope", () => {
    wrap(<BoardChatPanel {...chatProps} />);
    fireEvent.click(screen.getByTestId("board-chat-tab-jobs"));
    expect(screen.getByTestId("board-chat-jobs-plan")).toHaveTextContent("No plan yet");
    expect(screen.getByTestId("board-chat-jobs-worklog")).toHaveTextContent("No work logged yet");
    expect(screen.getByTestId("board-chat-jobs-checks")).toHaveTextContent(
      "No checks have run for this conversation yet.",
    );
    expect(screen.getByTestId("board-chat-jobs-live-steps-empty")).toBeInTheDocument();
    expect(screen.getByTestId("board-chat-jobs-approvals")).toHaveTextContent(
      "Approvals appear here once a project is open.",
    );
    expect(screen.getByTestId("board-chat-jobs-changes")).toHaveTextContent(
      "Changes appear here once a project is open.",
    );
    // No feed panel is mounted against a null project/conversation.
    expect(screen.queryByTestId("jobs-approvals-stub")).toBeNull();
    expect(screen.queryByTestId("jobs-changes-stub")).toBeNull();
    expect(screen.queryByTestId("jobs-live-steps-stub")).toBeNull();
  });

  it("Jobs mounts approvals (never a second checks instance), changes and live steps from real props", () => {
    const onOpenChecks = vi.fn();
    wrap(
      <BoardChatPanel
        {...chatProps}
        projectId="project-1"
        conversationId="conversation-1"
        onOpenChecks={onOpenChecks}
      />,
    );
    fireEvent.click(screen.getByTestId("board-chat-tab-jobs"));
    const approvals = screen.getByTestId("jobs-approvals-stub");
    expect(approvals).toHaveAttribute("data-mode", "approvals");
    expect(approvals).toHaveAttribute("data-project", "project-1");
    expect(approvals).toHaveAttribute("data-conversation", "conversation-1");
    // Single-home doctrine: no StudioHealthPanel mode="checks" anywhere in Jobs.
    expect(document.querySelector('[data-mode="checks"]')).toBeNull();
    expect(screen.getByTestId("jobs-changes-stub")).toHaveAttribute("data-project", "project-1");
    expect(screen.getByTestId("jobs-live-steps-stub")).toHaveAttribute(
      "data-conversation",
      "conversation-1",
    );
    // The Checks section summons the one board Checks panel.
    fireEvent.click(screen.getByTestId("board-chat-jobs-open-checks"));
    expect(onOpenChecks).toHaveBeenCalled();
  });

  it("shows the Site ready card when a run finishes — Preview only, no View Files button", () => {
    useExecutionStore.setState({
      phase: "done",
      isRunning: false,
      events: [executionEvent("e1", "Design landing page"), executionEvent("e2", "Build hero section")],
      checkpoint: { label: "Landing page build", gitSha: "abc123" },
    });
    wrap(<BoardChatPanel {...chatProps} />);
    const card = screen.getByTestId("board-chat-result-card");
    expect(card).toHaveTextContent("Test Project — Site ready!");
    expect(card).toHaveTextContent("Landing page build");
    fireEvent.click(screen.getByTestId("board-chat-result-preview"));
    expect(chatProps.onOpenPreview).toHaveBeenCalled();
    expect(screen.queryByTestId("board-chat-result-files")).toBeNull();
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
      "Tell LiTT what you want to build. LiTT drafts it, shows you every change, and nothing goes live without your say.",
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
