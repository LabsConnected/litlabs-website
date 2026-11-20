import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useState } from "react";

// Voice/theme mocks — only needed by the CommandComposer row test below
// (UnifiedSelector itself does not use them).
vi.mock("@/app/(app)/studio/context/VoiceSessionContext", () => ({
  useVoiceSession: () => ({
    voiceState: "idle",
    voiceOutputState: "idle",
    isMuted: false,
    startVoice: vi.fn(),
    stopVoice: vi.fn(),
    interrupt: vi.fn(),
    toggleMute: vi.fn(),
    setOnTurn: vi.fn(),
    speakText: vi.fn(),
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

// Plan access fully unlocked; the selector's gating logic itself is
// covered by the plan helpers — here we test the interface.
vi.mock("@/app/(app)/studio/hooks/useUserPlan", () => ({
  useUserPlan: () => ({
    plan: "pro_builder_beta",
    loading: false,
    hasAccess: () => true,
  }),
}));

import CommandComposer from "./CommandComposer";
import UnifiedSelectorPopover from "./UnifiedSelector";
import { useStudioModelStore, MODELS } from "../stores/useStudioModelStore";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  fireEvent(window, new Event("resize"));
}

/**
 * Mirrors how CommandStudio hosts the selector after the chat-bar
 * cleanup (2026-11-20): CommandStudio owns the open state, the popover
 * is portaled with an anchor rect, and model selection writes the
 * shared model store.
 */
function SelectorHost() {
  const [open, setOpen] = useState(false);
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);
  const selectModel = useStudioModelStore((s) => s.selectModel);
  return (
    <>
      <button type="button" data-testid="open-selector" onClick={() => setOpen(true)}>
        Open selector
      </button>
      {open && (
        <UnifiedSelectorPopover
          rect={{ top: 600, bottom: 700, left: 100, right: 500, width: 400, height: 100 }}
          activeAgentId="litt"
          selectedModelId={selectedModel.id}
          providerHealth={providerHealth}
          onClose={() => setOpen(false)}
          onAgentSelect={vi.fn()}
          onModelSelect={selectModel}
        />
      )}
    </>
  );
}

function openSelector() {
  fireEvent.click(screen.getByTestId("open-selector"));
  return screen.getByRole("dialog", { name: /select assistant and model/i });
}

describe("UnifiedSelectorPopover — model selector (chat-bar cleanup host)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Offline Ollama probe — the Local section must simply stay hidden.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    localStorage.clear();
    // Reset the shared model store to the default (LiTT Auto).
    const auto = MODELS.find((m) => m.id === "litt-auto")!;
    useStudioModelStore.getState().selectModel(auto);
    document.body.style.overflow = "";
    setViewport(1280, 800);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setViewport(1024, 768);
  });

  it("opens as a desktop popover with Model and Assistant as separate tabs", () => {
    render(<SelectorHost />);
    const dialog = openSelector();
    expect(dialog).toBeTruthy();
    expect(screen.queryByTestId("unified-selector-backdrop")).toBeNull();
    expect(screen.getByTestId("selector-tab-model").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("selector-tab-assistant")).toBeTruthy();
    // Model list lives in its own scrolling region.
    expect(screen.getByTestId("unified-selector-list")).toBeTruthy();
  });

  it("shows free provider models up top and keeps Advanced collapsed", () => {
    render(<SelectorHost />);
    openSelector();
    expect(screen.getByText(/your keys — byok/i)).toBeTruthy();
    expect(screen.getByText(/free models/i)).toBeTruthy();
    // A free provider model is visible WITHOUT expanding Advanced.
    expect(screen.getByRole("button", { name: /gemini 2\.5 flash/i })).toBeTruthy();
    // Advanced aliases stay hidden until requested.
    expect(screen.queryByRole("button", { name: /litt reasoning/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /advanced models/i }));
    expect(screen.getByRole("button", { name: /litt reasoning/i })).toBeTruthy();
  });

  it("search filters models and surfaces Advanced matches without expanding", () => {
    render(<SelectorHost />);
    openSelector();
    const search = screen.getByTestId("model-search-input");
    fireEvent.change(search, { target: { value: "reasoning" } });
    // LiTT Reasoning lives in Advanced, yet search finds it directly.
    expect(screen.getByRole("button", { name: /litt reasoning/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /gpt-4o \(byok\)/i })).toBeNull();
    fireEvent.change(search, { target: { value: "gemini vision" } });
    expect(screen.getByRole("button", { name: /gemini vision/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /gemini creative/i })).toBeNull();
  });

  it("shows the current selection in the header and marks the active row", () => {
    render(<SelectorHost />);
    openSelector();
    expect(screen.getByText(/now using/i)).toBeTruthy();
    const active = document.querySelector('[data-active-model="true"]');
    expect(active?.textContent).toContain("LiTT Auto");
    expect(active?.getAttribute("aria-current")).toBe("true");
  });

  it("selecting a model updates the store and closes the selector", async () => {
    render(<SelectorHost />);
    openSelector();
    fireEvent.click(screen.getByRole("button", { name: /gpt-4o \(byok\)/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /select assistant and model/i })).toBeNull(),
    );
    expect(useStudioModelStore.getState().selectedModel.id).toBe("gpt-4o");
  });

  it("Escape and outside tap close the selector", async () => {
    render(<SelectorHost />);
    openSelector();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /select assistant and model/i })).toBeNull(),
    );
    openSelector();
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /select assistant and model/i })).toBeNull(),
    );
  });

  it("Assistant tab holds the modes, separate from the model list", () => {
    render(<SelectorHost />);
    openSelector();
    fireEvent.click(screen.getByTestId("selector-tab-assistant"));
    expect(screen.getByText(/assistant mode/i)).toBeTruthy();
    expect(screen.getByText(/normal main assistant/i)).toBeTruthy();
    // Model rows are not crammed into the Assistant tab.
    expect(screen.queryByRole("button", { name: /gpt-4o \(byok\)/i })).toBeNull();
    expect(screen.queryByTestId("model-search-input")).toBeNull();
  });

  it("mobile width renders a bottom sheet and locks background scroll", async () => {
    setViewport(390, 844);
    render(<SelectorHost />);
    // Re-run the viewport effect at mobile width before opening.
    setViewport(390, 844);
    const dialog = openSelector();
    expect(screen.getByTestId("unified-selector-backdrop")).toBeTruthy();
    expect(dialog.className).toContain("inset-x-0");
    expect(dialog.className).toContain("rounded-t-2xl");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /select assistant and model/i })).toBeNull(),
    );
    expect(document.body.style.overflow).toBe("");
  });

  it("reopening shows the previously selected model as active", () => {
    render(<SelectorHost />);
    openSelector();
    fireEvent.click(screen.getByRole("button", { name: /claude sonnet \(byok\)/i }));
    openSelector();
    const active = document.querySelector('[data-active-model="true"]');
    expect(active?.textContent).toContain("Claude Sonnet (BYOK)");
  });
});

describe("CommandComposer row — clean chat bar (Larry, 2026-11-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    localStorage.clear();
    setViewport(390, 844);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setViewport(1024, 768);
  });

  it("has no round selector button in the composer row — just text box, +, mic, send", () => {
    render(<CommandComposer value="" onChange={vi.fn()} onSend={vi.fn()} busy={false} />);
    // The round avatar/selector button is gone from the row.
    expect(screen.queryByTestId("unified-selector-trigger")).toBeNull();
    // The approved bar remains: attach (+), voice (mic), one send button.
    expect(screen.getByLabelText("Attach files, media, or links")).toBeTruthy();
    expect(screen.getByLabelText("Start voice")).toBeTruthy();
    expect(screen.getByTestId("studio-send-button")).toBeTruthy();
    expect(screen.getByPlaceholderText(/ask litt anything/i)).toBeTruthy();
  });
});
