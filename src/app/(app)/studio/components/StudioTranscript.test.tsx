import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Capture downloads without touching the DOM download machinery.
const { downloadTextFileMock } = vi.hoisted(() => ({
  downloadTextFileMock: vi.fn(),
}));
vi.mock("@/lib/studio/message-copy", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/studio/message-copy")>();
  return { ...actual, downloadTextFile: downloadTextFileMock };
});

// jsdom does not implement scrollTo — polyfill it for the transcript's
// auto-scroll useEffect.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

// Mock voice session
vi.mock("@/app/(app)/studio/context/VoiceSessionContext", () => ({
  useVoiceSession: () => ({
    voiceState: "idle",
    isMuted: false,
    startVoice: vi.fn(),
    stopVoice: vi.fn(),
    interrupt: vi.fn(),
    toggleMute: vi.fn(),
    speakText: vi.fn(),
  }),
  VoiceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock terminal store
vi.mock("@/stores/useTerminalStore", () => ({
  useTerminalStore: () => ({
    isUsable: () => false,
  }),
}));

// Mock litt-context parseJarvisActions
vi.mock("@/lib/litt-context", () => ({
  parseJarvisActions: (text: string) => {
    const match = text.match(/\[cmd:([^\]]+)\]/);
    return match ? [{ command: match[1] }] : [];
  },
}));

// Mock ActionChips
vi.mock("./canvas/ActionChips", () => ({
  ActionChips: () => null,
}));

// Mock UserMessageAvatar
vi.mock("@/components/chat/MessageAvatar", () => ({
  UserMessageAvatar: () => <div data-testid="user-avatar" />,
}));

import StudioTranscript from "./StudioTranscript";
import type { ChatMessage, AgentId } from "../stores/useStudioAgentStore";
import { useExecutionStore } from "../stores/useExecutionStore";

describe("StudioTranscript — Phase 1.1 functional tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders user message when messages exist", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Build a landing page", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Build a landing page")).toBeTruthy();
  });

  it("renders assistant response when present", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello", createdAt: Date.now() },
      { role: "assistant", content: "I'm ready to help.", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    expect(screen.getByText("I'm ready to help.")).toBeTruthy();
  });

  it("renders completion summary with explicit mutation categories and recovery feedback", () => {
    render(
      <StudioTranscript
        messages={[{ role: "assistant", content: "Finished the build.", createdAt: Date.now() }]}
        busy={false}
        activeAgentId={"litt" as AgentId}
        completion={{
          changes: { added: 1, modified: 2, deleted: 1, renamed: 1 },
          previewUpdated: true,
          repaired: true,
        }}
        onDismissCompletion={vi.fn()}
        onUndoCompletion={vi.fn()}
        onContinueCompletion={vi.fn()}
      />,
    );

    const completion = screen.getByTestId("studio-completion");
    expect(completion.textContent).toContain("1 created");
    expect(completion.textContent).toContain("2 modified");
    expect(completion.textContent).toContain("1 deleted");
    expect(completion.textContent).toContain("1 renamed");
    expect(completion.textContent).toContain("recovered automatically");
    expect(completion.textContent).toContain("Preview updated");
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("renders nothing (empty) when messages array is empty", () => {
    const { container } = render(
      <StudioTranscript
        messages={[]}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    // No user message text should be present
    expect(container.textContent?.trim()).toBe("");
  });

  it("shows busy indicator when busy=true and no pending assistant message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Working...", createdAt: Date.now() },
    ];
    const { container } = render(
      <StudioTranscript
        messages={messages}
        busy={true}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    // The busy indicator uses animate-pulse dots
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThan(0);
  });

  it("does not render hidden opacity-0 controls", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Test", createdAt: Date.now() },
      { role: "assistant", content: "Response", createdAt: Date.now() },
    ];
    const { container } = render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    // No element should have opacity:0 style
    const allElements = container.querySelectorAll("*");
    allElements.forEach((el) => {
      const style = (el as HTMLElement).style;
      expect(style.opacity).not.toBe("0");
    });
  });

  it("renders agent name label (LiTT) for assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "Hi", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    expect(screen.getByText("LiTT")).toBeTruthy();
  });

  it("renders regenerate button on last assistant message when not busy", () => {
    const onRegenerate = vi.fn();
    const messages: ChatMessage[] = [
      { role: "user", content: "Q", createdAt: Date.now() },
      { role: "assistant", content: "A", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
        onRegenerateAction={onRegenerate}
      />,
    );
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeTruthy();
  });

  it("does not render regenerate button when busy", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Q", createdAt: Date.now() },
      { role: "assistant", content: "A", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={true}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
        onRegenerateAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("does not render empty non-streaming assistant bubbles", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello", createdAt: Date.now() },
      { role: "assistant", content: "", status: "completed", createdAt: Date.now() },
    ];
    const { container } = render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    // The empty assistant bubble should be skipped — no "LiTT" label
    // should appear since the only assistant message is empty and not streaming.
    expect(screen.queryByText("LiTT")).toBeNull();
    // Only the user message should be present
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
  });

  it("renders streaming assistant bubble even when content is empty", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Thinking...", createdAt: Date.now() },
      { role: "assistant", content: "", status: "streaming", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={true}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    // The streaming assistant bubble should now visibly show thinking state.
    expect(screen.getByText(/LiTT is thinking/i)).toBeTruthy();
  });

  it("shows Retry button for failed assistant messages", () => {
    const onRegenerate = vi.fn();
    const messages: ChatMessage[] = [
      { role: "user", content: "Q", createdAt: Date.now() },
      { role: "assistant", content: "Provider unavailable", status: "failed", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
        onRegenerateAction={onRegenerate}
      />,
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("does not show Read button on failed assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "Error occurred", status: "failed", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /read aloud/i })).toBeNull();
  });

  it("uses message.id as React key, not array index", () => {
    const messages: ChatMessage[] = [
      { id: "msg-1", role: "user", content: "First", createdAt: Date.now() },
      { id: "msg-2", role: "assistant", content: "Second", status: "completed", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    // Both messages should render
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("does not show duplicate busy indicator when last message is streaming", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Q", createdAt: Date.now() },
      { role: "assistant", content: "partial...", status: "streaming", createdAt: Date.now() },
    ];
    const { container } = render(
      <StudioTranscript
        messages={messages}
        busy={true}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
    // The standalone busy indicator should NOT appear since the last
    // message is already streaming (has its own indicator via the bubble).
    // There should be no extra animate-pulse dots beyond what's in the
    // streaming message itself.
    const pulses = container.querySelectorAll(".animate-pulse");
    // The streaming message bubble doesn't use animate-pulse, so there
    // should be zero standalone busy indicators.
    expect(pulses.length).toBe(0);
  });
});

/* ── False-completion regression (Ember Roast V1 Acceptance) ─────── */

/**
 * Production evidence: LiTT replied conversationally to a build request and
 * the transcript displayed "Work log · 1 of 1 steps complete" with no tool
 * call, no file mutation, no build and no deployment.
 *
 * Root cause: the work log counted `message.actions?.length ?? 1`, so any
 * assistant message with text rendered as one completed step.
 */
describe("StudioTranscript — truthful work log", () => {
  const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    role: "assistant",
    content: "I'm ready to build the Ember Roast site.",
    status: "completed",
    createdAt: Date.now(),
    ...over,
  });

  function renderWith(messages: ChatMessage[]) {
    return render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
  }

  it("renders NO work log for a conversational reply with no execution evidence", () => {
    renderWith([assistant()]);
    expect(screen.queryByTestId("studio-work-log")).toBeNull();
  });

  it("never claims '1 of 1 steps complete' without execution evidence", () => {
    const { container } = renderWith([assistant()]);
    expect(container.textContent).not.toMatch(/1 of 1 steps complete/);
  });

  it("does not count proposed canvas actions as completed steps", () => {
    // `actions` are PROPOSALS the user can click — not work that happened.
    renderWith([assistant({
      actions: [
        { type: "create_file", path: "index.html" },
        { type: "create_file", path: "styles.css" },
      ] as unknown as ChatMessage["actions"],
    })]);
    expect(screen.queryByTestId("studio-work-log")).toBeNull();
  });

  it("reports work not started when a build was requested but nothing ran", () => {
    renderWith([assistant({
      execution: { mode: "build", toolCalls: [] },
    } as Partial<ChatMessage>)]);
    const log = screen.getByTestId("studio-work-log");
    expect(log.textContent).toMatch(/no action taken/i);
    expect(log.textContent).not.toMatch(/complete/i);
  });

  it("reports real step counts from successful tool results", () => {
    renderWith([assistant({
      execution: {
        mode: "build",
        toolCalls: [
          { toolId: "read_file", success: true, mutating: false },
          { toolId: "edit_file", success: true, mutating: true },
        ],
      },
    } as Partial<ChatMessage>)]);
    expect(screen.getByTestId("studio-work-log").textContent).toContain("2 of 2 steps complete");
  });

  it("reports a deploy request with no deployment as partial, not complete", () => {
    renderWith([assistant({
      execution: {
        mode: "ship",
        toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
      },
    } as Partial<ChatMessage>)]);
    const log = screen.getByTestId("studio-work-log");
    expect(log.textContent).toMatch(/deployment missing/i);
  });
});

describe("StudioTranscript — overflowDownloads (mobile density redesign)", () => {
  const downloadable: ChatMessage[] = [
    { role: "user", content: "Hello", createdAt: Date.now() },
    { role: "assistant", content: "Hi there.", createdAt: Date.now() },
  ];

  function renderTranscript(overflowDownloads?: boolean) {
    return render(
      <StudioTranscript
        messages={downloadable}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
        overflowDownloads={overflowDownloads}
      />,
    );
  }

  beforeEach(() => {
    downloadTextFileMock.mockClear();
  });

  it("collapses the download pills into a single overflow button when enabled", () => {
    renderTranscript(true);
    const overflow = screen.getByTestId("transcript-overflow");
    expect(overflow).toBeInTheDocument();
    expect(overflow).toHaveAttribute("aria-expanded", "false");
    // The pills stay hidden until the overflow menu opens.
    expect(screen.queryByTestId("download-txt")).toBeNull();
    expect(screen.queryByTestId("download-md")).toBeNull();
  });

  it("opens the overflow menu with both downloads and wires the original handlers", () => {
    renderTranscript(true);
    fireEvent.click(screen.getByTestId("transcript-overflow"));

    expect(screen.getByTestId("transcript-overflow")).toHaveAttribute("aria-expanded", "true");
    const txt = screen.getByTestId("download-txt");
    const md = screen.getByTestId("download-md");
    expect(txt).toBeInTheDocument();
    expect(md).toBeInTheDocument();

    fireEvent.click(txt);
    expect(downloadTextFileMock).toHaveBeenCalledTimes(1);
    expect(downloadTextFileMock.mock.calls[0][0]).toMatch(/\.txt$/);
    // Choosing an option closes the menu.
    expect(screen.queryByTestId("download-txt")).toBeNull();
    expect(screen.queryByTestId("download-md")).toBeNull();
  });

  it("keeps the two download pills directly visible on desktop (default)", () => {
    renderTranscript();
    expect(screen.queryByTestId("transcript-overflow")).toBeNull();

    const txt = screen.getByTestId("download-txt");
    const md = screen.getByTestId("download-md");
    expect(txt).toBeInTheDocument();
    expect(md).toBeInTheDocument();

    fireEvent.click(md);
    expect(downloadTextFileMock).toHaveBeenCalledTimes(1);
    expect(downloadTextFileMock.mock.calls[0][0]).toMatch(/\.md$/);
  });
});

/* ── Conversation/execution separation (polish program #6) ────────── */

/**
 * One concise progress block per run; low-level events behind a collapsed
 * "Details" expander; the verdict line derived from execution evidence only;
 * conversation replies in their own prominent lane.
 */
describe("StudioTranscript — conversation/execution separation", () => {
  const runMessage = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    role: "assistant",
    content: "Here's your audit report.",
    status: "completed",
    createdAt: Date.now(),
    ...over,
  });

  const successfulBuild = () =>
    runMessage({
      execution: {
        mode: "build",
        toolCalls: [
          { toolId: "read_file", success: true, mutating: false },
          { toolId: "edit_file", success: true, mutating: true },
        ],
      },
      toolActivity: [
        { toolId: "read_file", success: true, summary: "Reading index.html" },
        { toolId: "edit_file", success: true, summary: "Editing index.html" },
      ],
    });

  function renderTranscript(messages: ChatMessage[], busy = false) {
    return render(
      <StudioTranscript
        messages={messages}
        busy={busy}
        activeAgentId={"litt" as AgentId}
        onRouteToolAction={vi.fn()}
      />,
    );
  }

  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  afterEach(() => {
    useExecutionStore.getState().reset();
  });

  it("collapses a completed run's low-level events behind a Details expander by default", () => {
    renderTranscript([successfulBuild()]);

    const lane = screen.getByTestId("studio-execution-block");
    expect(lane).toBeInTheDocument();

    const toggle = screen.getByTestId("execution-details-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Raw records are hidden until the user expands them.
    expect(screen.queryByTestId("execution-details")).toBeNull();
    expect(screen.queryByText("Reading index.html")).toBeNull();
    expect(screen.queryByText("Editing index.html")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("execution-details")).toBeInTheDocument();
    expect(screen.getByText("Reading index.html")).toBeInTheDocument();
    expect(screen.getByText("Editing index.html")).toBeInTheDocument();
  });

  it("collapses the live run's raw events behind Details while running", () => {
    useExecutionStore.setState({
      phase: "editing",
      isRunning: true,
      events: [
        {
          id: "e1",
          seq: 0,
          ts: Date.now(),
          type: "tool_start",
          summary: "Reading index.html",
          toolId: "read_file",
          lowLevel: true,
        },
        {
          id: "e2",
          seq: 1,
          ts: Date.now(),
          type: "reasoning",
          summary: "Considering layout options",
        },
      ],
    });
    renderTranscript(
      [
        { role: "user", content: "Audit my site", createdAt: Date.now() },
        { role: "assistant", content: "", status: "streaming", createdAt: Date.now() },
      ],
      true,
    );

    // One concise progress block for the live run.
    expect(screen.getByTestId("studio-live-progress")).toBeInTheDocument();

    // The raw firehose stays collapsed.
    const toggle = screen.getByTestId("execution-details-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("execution-details")).toBeNull();
    expect(screen.queryByText("Reading index.html")).toBeNull();
    expect(screen.queryByText("Considering layout options")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByTestId("execution-details")).toBeInTheDocument();
    expect(screen.getByText("Reading index.html")).toBeInTheDocument();
    expect(screen.getByText("Considering layout options")).toBeInTheDocument();
  });

  it("derives the success verdict from execution evidence inside the execution lane", () => {
    renderTranscript([successfulBuild()]);
    const lane = screen.getByTestId("studio-execution-block");
    const verdict = screen.getByTestId("studio-work-log");
    expect(lane).toContainElement(verdict);
    expect(verdict.textContent).toContain("2 of 2 steps complete");
  });

  it("verdict line tells the truth for a failed run — no false success", () => {
    renderTranscript([
      runMessage({
        content: "The build broke.",
        status: "failed",
        execution: {
          mode: "build",
          toolCalls: [{ toolId: "edit_file", success: false, mutating: true }],
          workspaceChange: { status: "unchanged" },
        },
        toolActivity: [{ toolId: "edit_file", success: false, summary: "Editing index.html" }],
      }),
    ]);
    const verdict = screen.getByTestId("studio-work-log");
    expect(verdict.textContent).toMatch(/0 of 1 steps complete — failed/);
    const lane = screen.getByTestId("studio-execution-block");
    expect(lane.textContent).not.toMatch(/done!/i);
    expect(lane.textContent).not.toMatch(/completed successfully/i);
  });

  it("verdict line reports partial when the deployment never happened", () => {
    renderTranscript([
      runMessage({
        execution: {
          mode: "ship",
          toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
        },
      }),
    ]);
    const verdict = screen.getByTestId("studio-work-log");
    expect(verdict.textContent).toMatch(/deployment missing/i);
    expect(screen.getByTestId("studio-execution-block")).toContainElement(verdict);
  });

  it("renders the reply in its own conversation lane, separate from the execution lane", () => {
    renderTranscript([successfulBuild()]);
    const lane = screen.getByTestId("studio-execution-block");
    // The reply text lives in the conversation bubble, not the execution lane.
    expect(lane.textContent).not.toContain("audit report");
    expect(screen.getByText(/Here's your audit report/)).toBeInTheDocument();
    // The verdict lives in the execution lane, not the conversation bubble.
    const verdict = screen.getByTestId("studio-work-log");
    expect(lane).toContainElement(verdict);
  });

  it("renders no execution lane for a conversational reply", () => {
    renderTranscript([runMessage()]);
    expect(screen.queryByTestId("studio-execution-block")).toBeNull();
    expect(screen.getByText(/Here's your audit report/)).toBeInTheDocument();
  });
});
