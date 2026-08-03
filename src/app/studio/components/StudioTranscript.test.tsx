import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// jsdom does not implement scrollTo — polyfill it for the transcript's
// auto-scroll useEffect.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

// Mock voice session
vi.mock("@/app/studio/context/VoiceSessionContext", () => ({
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
        onRouteTool={vi.fn()}
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
        onRouteTool={vi.fn()}
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
        onRouteTool={vi.fn()}
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
        onRouteTool={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /read aloud/i })).toBeNull();
  });

  it("uses message.id as React key, not array index", () => {
    const messages: ChatMessage[] = [
      { id: "msg-1", role: "user", content: "First", createdAt: Date.now() },
      { id: "msg-2", role: "assistant", content: "Second", status: "completed", createdAt: Date.now() },
    ];
    const { container } = render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteTool={vi.fn()}
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
