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
import type { StudioMessage } from "../types/conversation";
import type { AgentId } from "../stores/useStudioAgentStore";

// Helper to create StudioMessage with required fields
function msg(role: "user" | "assistant", content: string, extra?: Partial<StudioMessage>): StudioMessage {
  return { id: `test-${Math.random()}`, role, content, status: "complete", createdAt: Date.now(), ...extra };
}

describe("StudioTranscript — Phase 1.1 functional tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders user message when messages exist", () => {
    const messages: StudioMessage[] = [
      { id: `test-${Math.random()}`, role: "user", content: "Build a landing page", status: "complete", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteTool={vi.fn()}
      />,
    );
    expect(screen.getByText("Build a landing page")).toBeTruthy();
  });

  it("renders assistant response when present", () => {
    const messages: StudioMessage[] = [
      { id: `test-${Math.random()}`, role: "user", content: "Hello", status: "complete", createdAt: Date.now() },
      { id: `test-${Math.random()}`, role: "assistant", content: "I'm ready to help.", status: "complete", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteTool={vi.fn()}
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
        onRouteTool={vi.fn()}
      />,
    );
    // No user message text should be present
    expect(container.textContent?.trim()).toBe("");
  });

  it("shows busy indicator when busy=true and no pending assistant message", () => {
    const messages: StudioMessage[] = [
      { id: `test-${Math.random()}`, role: "user", content: "Working...", status: "complete", createdAt: Date.now() },
    ];
    const { container } = render(
      <StudioTranscript
        messages={messages}
        busy={true}
        activeAgentId={"litt" as AgentId}
        onRouteTool={vi.fn()}
      />,
    );
    // The busy indicator uses animate-pulse dots
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThan(0);
  });

  it("does not render hidden opacity-0 controls", () => {
    const messages: StudioMessage[] = [
      { id: `test-${Math.random()}`, role: "user", content: "Test", status: "complete", createdAt: Date.now() },
      { id: `test-${Math.random()}`, role: "assistant", content: "Response", status: "complete", createdAt: Date.now() },
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
    const messages: StudioMessage[] = [
      { id: `test-${Math.random()}`, role: "assistant", content: "Hi", status: "complete", createdAt: Date.now() },
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
    const messages: StudioMessage[] = [
      { id: `test-${Math.random()}`, role: "user", content: "Q", status: "complete", createdAt: Date.now() },
      { id: `test-${Math.random()}`, role: "assistant", content: "A", status: "complete", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={false}
        activeAgentId={"litt" as AgentId}
        onRouteTool={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeTruthy();
  });

  it("does not render regenerate button when busy", () => {
    const messages: StudioMessage[] = [
      { id: `test-${Math.random()}`, role: "user", content: "Q", status: "complete", createdAt: Date.now() },
      { id: `test-${Math.random()}`, role: "assistant", content: "A", status: "complete", createdAt: Date.now() },
    ];
    render(
      <StudioTranscript
        messages={messages}
        busy={true}
        activeAgentId={"litt" as AgentId}
        onRouteTool={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });
});

