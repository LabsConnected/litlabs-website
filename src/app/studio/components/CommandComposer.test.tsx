import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the voice session context before importing the composer.
const startVoice = vi.fn();
const stopVoice = vi.fn();
const interrupt = vi.fn();
const toggleMute = vi.fn();
const speakText = vi.fn();

vi.mock("@/app/studio/context/VoiceSessionContext", () => ({
  useVoiceSession: () => ({
    voiceState: "idle",
    isMuted: false,
    startVoice,
    stopVoice,
    interrupt,
    toggleMute,
    setOnTurn: vi.fn(),
    speakText,
  }),
  VoiceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedColors: { accentColor: "#22d3ee", textColor: "#fff", textMuted: "#888" },
    layoutStyle: "compact",
  }),
}));

vi.mock("@/features/voice/store/useVoiceStore", () => ({
  useVoiceStore: () => ({ setActiveAgent: vi.fn() }),
}));

import CommandComposer from "./CommandComposer";

describe("CommandComposer — Phase 1.1 functional tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submit calls the real send controller exactly once", async () => {
    const onSend = vi.fn().mockResolvedValue({ accepted: true, reply: "Response from LiTT" });
    render(
      <CommandComposer
        value="Hello LiTT"
        onChange={vi.fn()}
        onSend={onSend}
        busy={false}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendBtn);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith("Hello LiTT", undefined);
  });

  it("busy state prevents duplicate submit", async () => {
    const onSend = vi.fn().mockResolvedValue({ accepted: true, reply: "response" });
    render(
      <CommandComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={onSend}
        busy={true}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendBtn);
    // Wait a tick to ensure no async call happens
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears text after successful submission", async () => {
    const onChange = vi.fn();
    const onSend = vi.fn().mockResolvedValue({ accepted: true, reply: "response" });
    render(
      <CommandComposer
        value="Test message"
        onChange={onChange}
        onSend={onSend}
        busy={false}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendBtn);
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    // onChange("") should have been called to clear the input
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not submit when input is empty and no attachments", async () => {
    const onSend = vi.fn();
    render(
      <CommandComposer
        value="   "
        onChange={vi.fn()}
        onSend={onSend}
        busy={false}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("rejected send restores text", async () => {
    const onChange = vi.fn();
    const onSend = vi.fn().mockResolvedValue({ accepted: false });
    render(
      <CommandComposer
        value="My message"
        onChange={onChange}
        onSend={onSend}
        busy={false}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendBtn);
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    // Text should be restored after rejection
    expect(onChange).toHaveBeenCalledWith("My message");
  });

  it("accepted local command clears text without restoring", async () => {
    const onChange = vi.fn();
    const onSend = vi.fn().mockResolvedValue({ accepted: true });
    render(
      <CommandComposer
        value="/clear"
        onChange={onChange}
        onSend={onSend}
        busy={false}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendBtn);
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    // onChange("") to clear, but NOT restored with "/clear"
    expect(onChange).toHaveBeenCalledWith("");
    expect(onChange).not.toHaveBeenCalledWith("/clear");
  });

  it("two rapid clicks invoke controller once", async () => {
    const onSend = vi.fn().mockResolvedValue({ accepted: true, reply: "response" });
    render(
      <CommandComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={onSend}
        busy={false}
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendBtn);
    fireEvent.click(sendBtn); // rapid double-click
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("renders exactly one composer (no duplicate)", () => {
    const onSend = vi.fn();
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={onSend}
        busy={false}
      />,
    );
    // There should be exactly one textarea (the composer input)
    const textareas = screen.getAllByRole("textbox", { name: /message input/i });
    expect(textareas).toHaveLength(1);
  });

  it("does not render a mode dropdown (only Auto label)", () => {
    const onSend = vi.fn();
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={onSend}
        busy={false}
      />,
    );
    // The mode selector should be a static span, not a button
    expect(screen.queryByRole("button", { name: /execution mode/i })).toBeNull();
    // "Auto" text should be visible
    expect(screen.getByText("Auto")).toBeTruthy();
  });

  it("camera button toggles camera", () => {
    const onToggleCamera = vi.fn();
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        busy={false}
        onToggleCamera={onToggleCamera}
        cameraActive={false}
      />,
    );
    const camBtn = screen.getByRole("button", { name: /camera/i });
    fireEvent.click(camBtn);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
  });
});
