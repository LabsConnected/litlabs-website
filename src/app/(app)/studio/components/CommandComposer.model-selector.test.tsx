import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Same voice/theme mocks as CommandComposer.test.tsx.
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
import { useStudioModelStore, MODELS } from "../stores/useStudioModelStore";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  fireEvent(window, new Event("resize"));
}

function renderComposer() {
  return render(
    <CommandComposer value="" onChange={vi.fn()} onSend={vi.fn()} busy={false} />,
  );
}

function openSelector() {
  fireEvent.click(screen.getByTestId("unified-selector-trigger"));
  return screen.getByRole("dialog", { name: /select assistant and model/i });
}

describe("UnifiedSelectorPopover — model selector fix", () => {
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
    renderComposer();
    const dialog = openSelector();
    expect(dialog).toBeTruthy();
    expect(screen.queryByTestId("unified-selector-backdrop")).toBeNull();
    expect(screen.getByTestId("selector-tab-model").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("selector-tab-assistant")).toBeTruthy();
    // Model list lives in its own scrolling region.
    expect(screen.getByTestId("unified-selector-list")).toBeTruthy();
  });

  it("shows free provider models up top and keeps Advanced collapsed", () => {
    renderComposer();
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
    renderComposer();
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
    renderComposer();
    openSelector();
    expect(screen.getByText(/now using/i)).toBeTruthy();
    const active = document.querySelector('[data-active-model="true"]');
    expect(active?.textContent).toContain("LiTT Auto");
    expect(active?.getAttribute("aria-current")).toBe("true");
  });

  it("selecting a model updates the store and closes the selector", async () => {
    renderComposer();
    openSelector();
    fireEvent.click(screen.getByRole("button", { name: /gpt-4o \(byok\)/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /select assistant and model/i })).toBeNull(),
    );
    expect(useStudioModelStore.getState().selectedModel.id).toBe("gpt-4o");
    const trigger = screen.getByTestId("unified-selector-trigger");
    expect(trigger.getAttribute("title")).toContain("GPT-4o (BYOK)");
  });

  it("Escape and outside tap close the selector", async () => {
    renderComposer();
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
    renderComposer();
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
    renderComposer();
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
    renderComposer();
    openSelector();
    fireEvent.click(screen.getByRole("button", { name: /claude sonnet \(byok\)/i }));
    openSelector();
    const active = document.querySelector('[data-active-model="true"]');
    expect(active?.textContent).toContain("Claude Sonnet (BYOK)");
  });
});
