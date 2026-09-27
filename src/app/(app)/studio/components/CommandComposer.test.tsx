import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock the voice session context before importing the composer.
const startVoice = vi.fn();
const stopVoice = vi.fn();
const interrupt = vi.fn();
const toggleMute = vi.fn();
const speakText = vi.fn();

vi.mock("@/app/(app)/studio/context/VoiceSessionContext", () => ({
  useVoiceSession: () => ({
    voiceState: "idle",
    voiceOutputState: "idle",
    isMuted: false,
    startVoice,
    stopVoice,
    interrupt,
    toggleMute,
    setOnTurn: vi.fn(),
    speakText,
    stopSpeaking: vi.fn(),
    ttsEnabled: false,
    toggleTts: vi.fn(),
    autoSendEnabled: false,
    toggleAutoSend: vi.fn(),
    cancelRecording: vi.fn(),
    micLevel: 0,
    transcript: "",
    recordingSeconds: 0,
    errorMessage: null,
    setOnTranscriptComplete: vi.fn(),
  }),
  VoiceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedColors: { accentColor: "#a8ff2f", textColor: "#fff", textMuted: "#888" },
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

  it("busy state exposes cancellation instead of submitting again", async () => {
    const onSend = vi.fn().mockResolvedValue({ accepted: true, reply: "response" });
    const onCancel = vi.fn();
    render(
      <CommandComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={onSend}
        onCancel={onCancel}
        busy={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel response/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
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

  it("keeps the message input on a full-width row", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        busy={false}
      />,
    );

    const input = screen.getByRole("textbox", { name: /message input/i });
    expect(input.className).toContain("w-full");
    expect(input.className).toContain("flex-none");
    expect(input.parentElement?.className).toContain("flex-wrap");
  });

  it("renders the active workspace context above the composer", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        contextLine={{ workspace: "Michigan Music Venue" }}
        busy={false}
      />,
    );

    expect(screen.getByTestId("studio-workspace-context").textContent).toContain(
      "Michigan Music Venue",
    );
  });

  it("renders the repo chip only once when repo matches the workspace name", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        contextLine={{ workspace: "LabsConnected/litlabs-website", repo: "LabsConnected/litlabs-website", branch: "main" }}
        busy={false}
      />,
    );

    const context = screen.getByTestId("studio-workspace-context");
    const occurrences = context.textContent?.split("LabsConnected/litlabs-website").length ?? 0;
    expect(occurrences - 1).toBe(1);
    expect(context.textContent).toContain("main");
  });

  it("keeps workspace context, input, and send control reachable on narrow sheets", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        contextLine={{ workspace: "Private LiTT workspace — created when you send", repo: "owner/a-very-long-project-name", branch: "main" }}
        busy={false}
      />,
    );

    const context = screen.getByTestId("studio-workspace-context");
    const input = screen.getByRole("textbox", { name: /message input/i });
    input.focus();

    expect(context.textContent).toContain("Private LiTT workspace");
    expect(context.className).toContain("flex-wrap");
    expect(context.className).toContain("max-w-full");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: /send message/i })).toBeVisible();
  });

  it("hides the workspace context line when hideContextLine is set (mobile)", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        contextLine={{ workspace: "Michigan Music Venue" }}
        hideContextLine
        busy={false}
      />,
    );

    expect(screen.queryByTestId("studio-workspace-context")).toBeNull();
    // Input and send control stay reachable.
    expect(screen.getByRole("textbox", { name: /message input/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send message/i })).toBeVisible();
  });

  it("compact mode shrinks composer chrome while keeping 44px action targets", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        contextLine={{ workspace: "Michigan Music Venue" }}
        compact
        busy={false}
      />,
    );

    const input = screen.getByRole("textbox", { name: /message input/i });
    expect(input.style.minHeight).toBe("40px");
    // 44px action buttons are untouched in compact mode.
    expect(screen.getByRole("button", { name: /send message/i }).className).toContain("h-11");
  });

  it("shows the active model picker without an execution-mode dropdown", () => {
    const onSend = vi.fn();
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={onSend}
        busy={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /execution mode/i })).toBeNull();
    // Model picker is a button with aria-label "Select assistant and model"
    expect(screen.getByRole("button", { name: /select assistant and model/i })).toBeTruthy();
  });

  it("renders an agent selector with model picker", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        busy={false}
      />,
    );

    // Unified assistant + model picker is present (popover only opens on click)
    expect(screen.getByRole("button", { name: /select assistant and model/i })).toBeTruthy();
    // The popover dialog is not open until clicked
    expect(screen.queryByRole("dialog", { name: /select assistant and model/i })).toBeNull();
  });

  it("camera button opens camera preview popover", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        busy={false}
      />,
    );
    const camBtn = screen.getByRole("button", { name: /open camera preview/i });
    fireEvent.click(camBtn);
    // Camera preview popover should appear
    expect(screen.getByTestId("camera-preview")).toBeTruthy();
  });
});

describe("CommandComposer — mobile input sizing (Phase 1 #8)", () => {
  it("uses the studio-command-input class instead of an inline 14px font size", () => {
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        busy={false}
      />,
    );
    const input = screen.getByTestId("studio-command-input") as HTMLTextAreaElement;
    // The class carries 14px desktop / 16px mobile via CSS; an inline
    // fontSize would beat the global mobile 16px rule and trigger iOS zoom.
    expect(input.className).toContain("studio-command-input");
    expect(input.style.fontSize).toBe("");
  });
});

describe("CommandComposer — mode pills removed (auto is permanent)", () => {
  const renderComposer = () =>
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        busy={false}
      />,
    );

  it.each(["Auto", "Image", "Music", "Video", "Code", "Website"])(
    "does not render a %s mode pill",
    (label) => {
      renderComposer();
      expect(
        screen.queryByRole("button", { name: `LiTT ${label} mode` }),
      ).toBeNull();
    },
  );

  it("placeholder is the default agent placeholder — never mode-specific", () => {
    renderComposer();
    const input = screen.getByTestId("studio-command-input") as HTMLTextAreaElement;
    expect(input.placeholder.length).toBeGreaterThan(0);
    expect(input.placeholder).not.toMatch(
      /video tool|music tool|image you want LiTT to create|what website or app to build|what code to write/i,
    );
  });
});

describe("CommandComposer — F1 selection context chips (slice B)", () => {
  const makeSelection = (
    over: Partial<import("./studioSelectionPayload").StudioSelectionPayload> = {},
  ): import("./studioSelectionPayload").StudioSelectionPayload => ({
    kind: "preview-element",
    label: "Hero heading",
    sourceFile: "components/Hero.tsx",
    projectId: "proj-1",
    timestamp: 1727280000000,
    ...over,
  });

  const renderComposer = (props: Partial<Parameters<typeof CommandComposer>[0]> = {}) =>
    render(
      <CommandComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        busy={false}
        {...props}
      />,
    );

  it("renders one chip per selection with label + source file", () => {
    renderComposer({
      selection: [
        makeSelection({ label: "Hero heading", sourceFile: "components/Hero.tsx" }),
        makeSelection({ label: "CTA button", sourceFile: "components/CTA.tsx", kind: "canvas-node" }),
      ],
    });
    const chips = screen.getAllByTestId("selection-context-chip");
    expect(chips).toHaveLength(2);
    expect(screen.getByTestId("selection-context-chips")).toBeInTheDocument();
    const labels = screen.getAllByTestId("selection-chip-label").map((el) => el.textContent);
    expect(labels).toEqual(["Hero heading", "CTA button"]);
    const sources = screen.getAllByTestId("selection-chip-source").map((el) => el.textContent);
    expect(sources).toEqual(["components/Hero.tsx", "components/CTA.tsx"]);
  });

  it("accepts a single (non-array) selection object", () => {
    renderComposer({ selection: makeSelection({ label: "Logo" }) });
    expect(screen.getAllByTestId("selection-context-chip")).toHaveLength(1);
    expect(screen.getByTestId("selection-chip-label").textContent).toBe("Logo");
  });

  it("renders route as the source when no sourceFile is present", () => {
    const sel = makeSelection({ label: "Pricing page" });
    delete (sel as Partial<typeof sel>).sourceFile;
    sel.route = "/pricing";
    renderComposer({ selection: sel });
    expect(screen.getByTestId("selection-chip-source").textContent).toBe("/pricing");
  });

  it("renders no source element when neither sourceFile nor route is present", () => {
    const sel = makeSelection({ label: "Logo" });
    delete (sel as Partial<typeof sel>).sourceFile;
    renderComposer({ selection: sel });
    expect(screen.queryByTestId("selection-chip-source")).toBeNull();
    expect(screen.getByTestId("selection-chip-label").textContent).toBe("Logo");
  });

  it("chip clear calls onClearSelectionItem with (index, item)", () => {
    const onClearSelectionItem = vi.fn();
    const items = [
      makeSelection({ label: "Hero heading" }),
      makeSelection({ label: "CTA button" }),
    ];
    renderComposer({ selection: items, onClearSelectionItem });
    const clearButtons = screen.getAllByTestId("selection-chip-clear");
    fireEvent.click(clearButtons[1]);
    expect(onClearSelectionItem).toHaveBeenCalledTimes(1);
    expect(onClearSelectionItem).toHaveBeenCalledWith(1, items[1]);
  });

  it("chip clear falls back to onClearSelectedElement when onClearSelectionItem is absent", () => {
    const onClearSelectedElement = vi.fn();
    renderComposer({ selection: makeSelection(), onClearSelectedElement });
    fireEvent.click(screen.getByTestId("selection-chip-clear"));
    expect(onClearSelectedElement).toHaveBeenCalledTimes(1);
  });

  it("structured selection takes precedence over the legacy selectedElement strip", () => {
    renderComposer({
      selection: makeSelection({ label: "Hero heading" }),
      contextLine: { selectedElement: "legacy label" },
    });
    expect(screen.getByTestId("selection-context-chips")).toBeInTheDocument();
    expect(screen.queryByTestId("selected-preview-context")).toBeNull();
  });

  it("legacy selectedElement strip still renders when no structured selection is given", () => {
    const onClearSelectedElement = vi.fn();
    renderComposer({
      contextLine: { selectedElement: "Hero heading" },
      onClearSelectedElement,
    });
    expect(screen.queryByTestId("selection-context-chips")).toBeNull();
    const strip = screen.getByTestId("selected-preview-context");
    expect(strip.textContent).toContain("Hero heading");
    fireEvent.click(screen.getByRole("button", { name: /clear selected preview element/i }));
    expect(onClearSelectedElement).toHaveBeenCalledTimes(1);
  });

  it("renders neither chips nor legacy strip when selection is null", () => {
    renderComposer({ selection: null });
    expect(screen.queryByTestId("selection-context-chips")).toBeNull();
    expect(screen.queryByTestId("selected-preview-context")).toBeNull();
  });

  it("chips row is viewport-safe (wraps, never forces page overflow)", () => {
    renderComposer({ selection: [makeSelection(), makeSelection({ label: "B" })] });
    const row = screen.getByTestId("selection-context-chips");
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("max-w-full");
    expect(row.className).toContain("overflow-x-auto");
  });
});
