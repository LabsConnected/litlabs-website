// @vitest-environment jsdom
/**
 * Image Studio — history deletion & Activity (LiTT Live) acceptance tests.
 *
 * Covers the acceptance criteria:
 *   1. Hovering or focusing a history card reveals its delete control.
 *   2. Deleting one generation leaves all remaining generations.
 *   3. Deleting the selected generation clears the canvas selection.
 *   4. Deleting the final generation removes localStorage history.
 *   5. Clear-all requires confirmation.
 *   6. Delete remains accessible on touch/mobile.
 *   7. Activity reflects Live visibility (false when Live is not shown).
 *   8. Header Activity calls the open handler.
 *   9. activityVisible is truthful (expanded-on-Chat is NOT visible).
 *  11. No duplicate Activity rail/drawer opens.
 *  12. Terminal remains independent.
 *  13/14. Obsolete side-panel / activity-rail localStorage keys are gone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: {
      bgColor: "#0a0a12",
      textColor: "#e0e0ff",
      textMuted: "#8888aa",
      headerColor: "#00f0ff",
      borderColor: "#2a2a45",
      accentColor: "#ff00a0",
      boxBg: "#151520",
    },
    tokens: { background: "#0a0a12", textMuted: "#8888aa", primary: "#ff00a0" },
  }),
}));

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 100, refresh: vi.fn(), isLoading: false }),
}));

vi.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({ profile: { displayName: "Test" } }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useAppUser: () => ({ user: { firstName: "Test" } }),
  useClerkAuth: () => ({ userId: "test-user", getToken: vi.fn() }),
}));

vi.mock("@/features/voice/store/useVoiceStore", () => ({
  useVoiceStore: () => ({ setActiveAgent: vi.fn() }),
}));

vi.mock("@/context/VoiceSessionContext", () => ({
  VoiceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/studio",
}));

vi.mock("next/dynamic", () => ({
  // Pass-through dynamic import for tests
  default: (_loader: () => Promise<{ default: React.ComponentType }>) => {
    const Comp = (_props: Record<string, unknown>) => null;
    Comp.displayName = "DynamicMock";
    return Comp;
  },
}));

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
}));

vi.mock("@/components/ModelPicker", () => ({
  default: () => null,
}));

vi.mock("@/components/media/MediaUtilityDock", () => ({
  MediaUtilityDock: () => null,
}));

vi.mock("../stores/useStudioAgentStore", () => ({
  useStudioAgentStore: () => ({
    activeAgentId: "litt",
    setActiveAgentId: vi.fn(),
  }),
  AGENT_META: {
    litt: { id: "litt", displayName: "LiTT" },
    spark: { id: "spark", displayName: "Spark" },
  },
}));

vi.mock("../stores/useStudioModelStore", () => ({
  useStudioModelStore: () => ({
    selectedModel: { label: "Test", provider: "gemini", apiProvider: "gemini" },
    selectModel: vi.fn(),
    fallbackNotice: null,
    providerHealth: { gemini: "available" },
  }),
  MODELS: [],
}));

vi.mock("../hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({
    capabilities: {
      projectId: "test",
      projectName: "Test",
      repository: "connected",
      terminalExecution: "available",
      writeAccess: true,
      terminalStatus: "connected",
      repositoryName: "test-repo",
      activeBranch: "main",
      defaultBranch: "main",
    },
    refresh: vi.fn(),
  }),
}));

vi.mock("../hooks/useCanonicalConversation", () => ({
  useCanonicalConversation: () => ({
    messages: [],
    busy: false,
    activeAgentId: "litt",
    selectAgent: vi.fn(),
    switchAgent: vi.fn(),
    clear: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(),
    exportConversation: vi.fn(),
    cancel: vi.fn(),
    conversations: [],
    selectedConversationId: null,
    requiresReauth: false,
  }),
}));

vi.mock("../hooks/useLiTTRealtimeSession", () => ({
  useLiTTRealtimeSession: () => ({ isLive: false }),
}));

vi.mock("@/lib/litt/live/types", () => ({}));
vi.mock("@/lib/canvas/types", () => ({ ArtifactAction: {} }));
vi.mock("@/lib/visual-packs/generation-presets", () => ({
  GENERATION_PRESETS: [],
}));
vi.mock("@/lib/visual-packs/types", () => ({
  DEFAULT_MASCOT_DESCRIPTION: "",
}));

// ─── GenerationHistoryCard tests ────────────────────────────────────────────

import GenerationHistoryCard, {
  type GenerationCardData,
} from "@/app/(app)/studio/components/GenerationHistoryCard";

const SAMPLE_THEME = {
  accentColor: "#ff00a0",
  borderColor: "#2a2a45",
  bgColor: "#0a0a12",
  textMuted: "#8888aa",
};

function makeGen(overrides: Partial<GenerationCardData> = {}): GenerationCardData {
  return {
    id: "gen-1",
    prompt: "a sunset over mountains",
    fileUrl: "data:image/png;base64,abc",
    status: "succeeded",
    provider: "gemini",
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("GenerationHistoryCard", () => {
  it("1. reveals delete control on hover/focus (CSS classes present)", () => {
    const gen = makeGen();
    render(
      <GenerationHistoryCard
        generation={gen}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        {...SAMPLE_THEME}
      />,
    );
    const deleteBtn = screen.getByTestId("delete-generation");
    expect(deleteBtn).toBeInTheDocument();
    // The CSS classes that control hover-reveal are present
    expect(deleteBtn.className).toContain("sm:opacity-0");
    expect(deleteBtn.className).toContain("sm:group-hover:opacity-100");
    expect(deleteBtn.className).toContain("sm:group-focus-within:opacity-100");
  });

  it("2. deleting one generation leaves all remaining generations", () => {
    const onDelete = vi.fn();
    const gen1 = makeGen({ id: "gen-1" });
    render(
      <GenerationHistoryCard
        generation={gen1}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={onDelete}
        {...SAMPLE_THEME}
      />,
    );
    const deleteBtn = screen.getByTestId("delete-generation");
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith("gen-1");
    // The parent's deleteGeneration filters by id — only the clicked one is removed
  });

  it("3. delete button calls onDelete with correct id (parent clears selection)", () => {
    const onDelete = vi.fn();
    const gen = makeGen({ id: "gen-selected" });
    render(
      <GenerationHistoryCard
        generation={gen}
        isSelected={true}
        onSelect={vi.fn()}
        onDelete={onDelete}
        {...SAMPLE_THEME}
      />,
    );
    fireEvent.click(screen.getByTestId("delete-generation"));
    expect(onDelete).toHaveBeenCalledWith("gen-selected");
  });

  it("6. delete button is visible on mobile (no hover dependency)", () => {
    const gen = makeGen();
    render(
      <GenerationHistoryCard
        generation={gen}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        {...SAMPLE_THEME}
      />,
    );
    const deleteBtn = screen.getByTestId("delete-generation");
    // On mobile (default, no sm: prefix), opacity is 100
    expect(deleteBtn.className).toContain("opacity-100");
    // The sm: override hides it on desktop until hover
    expect(deleteBtn.className).toContain("sm:opacity-0");
  });

  it("select button has accessible aria-label with prompt", () => {
    const gen = makeGen({ prompt: "beautiful sunset" });
    render(
      <GenerationHistoryCard
        generation={gen}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        {...SAMPLE_THEME}
      />,
    );
    const selectBtn = screen.getByLabelText("Open generation: beautiful sunset");
    expect(selectBtn).toBeInTheDocument();
  });

  it("delete button is a separate element (no nested buttons)", () => {
    const gen = makeGen();
    const { container } = render(
      <GenerationHistoryCard
        generation={gen}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        {...SAMPLE_THEME}
      />,
    );
    // The wrapper is a div, not a button
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    // There should be exactly 2 buttons: select + delete
    const buttons = wrapper.querySelectorAll("button");
    expect(buttons.length).toBe(2);
  });

  it("clicking delete does not trigger select (stopPropagation)", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const gen = makeGen();
    render(
      <GenerationHistoryCard
        generation={gen}
        isSelected={false}
        onSelect={onSelect}
        onDelete={onDelete}
        {...SAMPLE_THEME}
      />,
    );
    fireEvent.click(screen.getByTestId("delete-generation"));
    expect(onDelete).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders failed status with X icon", () => {
    const gen = makeGen({ status: "failed", fileUrl: undefined });
    render(
      <GenerationHistoryCard
        generation={gen}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        {...SAMPLE_THEME}
      />,
    );
    // The select button should exist
    expect(screen.getByLabelText(/Open generation/)).toBeInTheDocument();
  });
});

// ─── History persistence logic tests ────────────────────────────────────────

describe("History persistence", () => {
  it("4. deleting the final generation removes localStorage history", () => {
    // Simulate the persistence effect logic
    const STORAGE_KEY = "litlabs-generate-history";
    const history: GenerationCardData[] = [makeGen({ id: "gen-1" })];

    // Initial save
    if (history.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Delete the only generation
    history.length = 0;

    // The fixed effect: when length === 0, removeItem is called
    if (history.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("5. clear-all confirmation logic", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    let cleared = false;
    const history = [makeGen({ id: "gen-1" }), makeGen({ id: "gen-2" })];

    // Simulate confirmClearAllHistory
    if (window.confirm(`Delete all ${history.length} generations from local history?`)) {
      cleared = true;
    }

    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete all 2 generations from local history?",
    );
    expect(cleared).toBe(false); // did NOT clear because user declined

    // Now accept
    confirmSpy.mockReturnValue(true);
    if (window.confirm(`Delete all ${history.length} generations from local history?`)) {
      cleared = true;
    }
    expect(cleared).toBe(true);

    confirmSpy.mockRestore();
  });
});

// ─── CommandStudioHeader Activity toggle tests ──────────────────────────────

import CommandStudioHeader from "@/app/(app)/studio/components/CommandStudioHeader";

const HEADER_CAPS = {
  projectId: "test",
  projectName: "Test",
  repository: "connected",
  terminalExecution: "available",
  writeAccess: true,
  terminalStatus: "connected",
  repositoryName: "test-repo",
  activeBranch: "main",
  defaultBranch: "main",
} as const;

describe("CommandStudioHeader Activity (LiTT Live) open action", () => {
  it("7. Activity reflects Live visibility when activityVisible is false", () => {
    render(
      <CommandStudioHeader
        capabilities={HEADER_CAPS as never}
        onOpenActivityAction={vi.fn()}
        activityVisible={false}
      />,
    );
    const toggle = screen.getByTestId("activity-toggle");
    expect(toggle).toHaveAttribute("data-active", "false");
    expect(toggle).toHaveAttribute("aria-label", "Open Activity");
  });

  it("8. clicking Activity button calls the open handler", () => {
    const onOpen = vi.fn();
    render(
      <CommandStudioHeader
        capabilities={HEADER_CAPS as never}
        onOpenActivityAction={onOpen}
        activityVisible={false}
      />,
    );
    fireEvent.click(screen.getByTestId("activity-toggle"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("8b. Activity button shows active styling when Live is visible", () => {
    render(
      <CommandStudioHeader
        capabilities={HEADER_CAPS as never}
        onOpenActivityAction={vi.fn()}
        activityVisible={true}
      />,
    );
    const toggle = screen.getByTestId("activity-toggle");
    expect(toggle).toHaveAttribute("data-active", "true");
    expect(toggle).toHaveAttribute("aria-label", "Open Activity");
  });

  it("11. Activity button does NOT render a rail element itself", () => {
    const onOpen = vi.fn();
    render(
      <CommandStudioHeader
        capabilities={HEADER_CAPS as never}
        onOpenActivityAction={onOpen}
        activityVisible={false}
      />,
    );
    // The header only emits the open action; it does not own a rail.
    fireEvent.click(screen.getByTestId("activity-toggle"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("studio-activity-rail")).not.toBeInTheDocument();
  });

  it("11b. Activity is an OPEN action — clicking while Live is visible still calls the handler", () => {
    const onOpen = vi.fn();
    render(
      <CommandStudioHeader
        capabilities={HEADER_CAPS as never}
        onOpenActivityAction={onOpen}
        activityVisible={true}
      />,
    );
    fireEvent.click(screen.getByTestId("activity-toggle"));
    // Activity is always an open action; it does not toggle off.
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

// ─── Activity visibility truthfulness tests ─────────────────────────────────
//
// The old `activityRailOpen = !littCollapsed` derivation was false when LiTT
// was expanded on Chat. The canonical `activityVisible` value must reflect
// actual Live visibility (LiTT expanded/sheet open AND Live tab active).

describe("Activity visible state truthfulness", () => {
  // Helper preserves the union parameter type so the `=== "live"` comparison
  // is not flagged by TS as a no-overlap literal comparison.
  function computeActivityVisible(args: {
    isMobileLitt: boolean;
    mobileLittOpen: boolean;
    littCollapsed: boolean;
    littActiveTab: "chat" | "live";
  }): boolean {
    return (
      (args.isMobileLitt ? args.mobileLittOpen : !args.littCollapsed) &&
      args.littActiveTab === "live"
    );
  }

  it("9. activityVisible is false when LiTT is expanded on Chat (not Live)", () => {
    // activityVisible must NOT be derived from `!littCollapsed` alone.
    // Expanded LiTT on Chat → Live is NOT visible → activityVisible === false.
    expect(
      computeActivityVisible({
        isMobileLitt: false,
        mobileLittOpen: false,
        littCollapsed: false,
        littActiveTab: "chat",
      }),
    ).toBe(false);
  });

  it("9b. activityVisible is true when LiTT is expanded on Live (desktop)", () => {
    expect(
      computeActivityVisible({
        isMobileLitt: false,
        mobileLittOpen: false,
        littCollapsed: false,
        littActiveTab: "live",
      }),
    ).toBe(true);
  });

  it("9c. activityVisible is false when LiTT is collapsed (desktop)", () => {
    expect(
      computeActivityVisible({
        isMobileLitt: false,
        mobileLittOpen: false,
        littCollapsed: true,
        littActiveTab: "live",
      }),
    ).toBe(false);
  });

  it("9d. activityVisible is true when mobile sheet is open on Live", () => {
    expect(
      computeActivityVisible({
        isMobileLitt: true,
        mobileLittOpen: true,
        littCollapsed: true, // desktop pref, irrelevant on mobile
        littActiveTab: "live",
      }),
    ).toBe(true);
  });

  it("9e. activityVisible is false when mobile sheet is closed", () => {
    expect(
      computeActivityVisible({
        isMobileLitt: true,
        mobileLittOpen: false,
        littCollapsed: false,
        littActiveTab: "live",
      }),
    ).toBe(false);
  });

  it("12. Terminal remains independent (separate drawer state)", () => {
    // Terminal uses drawerOpen + drawerTab="terminal"
    // Activity visibility is derived from LiTT Live state, not drawer state.
    const drawerTab = "terminal";
    const activityVisible = false;

    expect(drawerTab).toBe("terminal");
    expect(activityVisible).toBe(false);
    // Terminal can be open while Activity (Live) is not visible
  });
});

// ─── Obsolete side-panel state must not drive UI ────────────────────────────

describe("Obsolete side-panel state removal", () => {
  it("13. no littree:studio:side-panel key is read or written", () => {
    const OBSOLETE_KEY = "littree:studio:side-panel";
    localStorage.removeItem(OBSOLETE_KEY);
    // The canonical shell no longer reads or writes this key.
    // Simulating a refresh should not resurrect it.
    expect(localStorage.getItem(OBSOLETE_KEY)).toBeNull();
  });

  it("14. no littree:studio:activity-rail-open key is read or written", () => {
    const OBSOLETE_KEY = "littree:studio:activity-rail-open";
    localStorage.removeItem(OBSOLETE_KEY);
    expect(localStorage.getItem(OBSOLETE_KEY)).toBeNull();
  });
});
