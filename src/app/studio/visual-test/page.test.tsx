import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Mock heavy dependencies to avoid mounting real components
vi.mock("../components/StudioTranscript", () => ({
  default: () => <div data-testid="transcript">transcript</div>,
}));
vi.mock("../components/CommandComposer", () => ({
  default: () => <div data-testid="composer">composer</div>,
}));
vi.mock("../components/StudioWorkspaceFrame", () => ({
  StudioInspector: () => <div data-testid="inspector">inspector</div>,
  StudioDrawer: () => <div data-testid="drawer">drawer</div>,
}));
vi.mock("../components/LiTEmptyState", () => ({
  default: () => <div data-testid="empty-state">empty</div>,
}));
vi.mock("./MockStudioHeader", () => ({
  default: () => <div data-testid="mock-header">header</div>,
}));
vi.mock("../context/VoiceSessionContext", () => ({
  VoiceSessionContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  defaultCtx: {} as never,
}));
vi.mock("../stores/useStudioAgentStore", () => ({
  useStudioAgentStore: { setState: () => {}, getState: () => ({}) },
  AGENT_META: {
    litt: { id: "litt", displayName: "LiTT", color: "#22d3ee", tag: "Operating", role: "Operating", placeholder: "", systemPrompt: "" },
    spark: { id: "spark", displayName: "Spark", color: "#f472b6", tag: "Creative", role: "Creative", placeholder: "", systemPrompt: "" },
  },
}));
vi.mock("../stores/useStudioModelStore", () => ({
  useStudioModelStore: { setState: () => {}, getState: () => ({}) },
}));
vi.mock("@/stores/useTerminalStore", () => ({
  useTerminalStore: { setState: () => {}, getState: () => ({}), subscribe: () => () => {} },
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ tokens: { background: "#000", text: "#fff" } }),
}));

describe("VisualTestPage — production gate", () => {
  it("returns 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VISUAL_TEST", "1");
    vi.resetModules();
    vi.doMock("../components/StudioTranscript", () => ({ default: () => <div data-testid="transcript">transcript</div> }));
    vi.doMock("../components/CommandComposer", () => ({ default: () => <div data-testid="composer">composer</div> }));
    vi.doMock("../components/StudioWorkspaceFrame", () => ({
      StudioInspector: () => <div data-testid="inspector">inspector</div>,
      StudioDrawer: () => <div data-testid="drawer">drawer</div>,
    }));
    vi.doMock("../components/LiTEmptyState", () => ({ default: () => <div data-testid="empty-state">empty</div> }));
    vi.doMock("./MockStudioHeader", () => ({ default: () => <div data-testid="mock-header">header</div> }));
    vi.doMock("../context/VoiceSessionContext", () => ({
      VoiceSessionContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
      defaultCtx: {} as never,
    }));
    vi.doMock("../stores/useStudioAgentStore", () => ({
      useStudioAgentStore: { setState: () => {}, getState: () => ({}) },
      AGENT_META: {
        litt: { id: "litt", displayName: "LiTT", color: "#22d3ee", tag: "Operating", role: "Operating", placeholder: "", systemPrompt: "" },
        spark: { id: "spark", displayName: "Spark", color: "#f472b6", tag: "Creative", role: "Creative", placeholder: "", systemPrompt: "" },
      },
    }));
    vi.doMock("../stores/useStudioModelStore", () => ({ useStudioModelStore: { setState: () => {}, getState: () => ({}) } }));
    vi.doMock("@/stores/useTerminalStore", () => ({ useTerminalStore: { setState: () => {}, getState: () => ({}), subscribe: () => () => {} } }));
    vi.doMock("@/context/ThemeContext", () => ({ useTheme: () => ({ tokens: { background: "#000", text: "#fff" } }) }));

    const { default: VisualTestPage } = await import("./page");
    await act(async () => { render(<VisualTestPage />); });
    expect(screen.getByText(/404/)).toBeTruthy();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 404 when VISUAL_TEST flag is not set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_VISUAL_TEST", "");
    vi.resetModules();
    vi.doMock("../components/StudioTranscript", () => ({ default: () => <div data-testid="transcript">transcript</div> }));
    vi.doMock("../components/CommandComposer", () => ({ default: () => <div data-testid="composer">composer</div> }));
    vi.doMock("../components/StudioWorkspaceFrame", () => ({
      StudioInspector: () => <div data-testid="inspector">inspector</div>,
      StudioDrawer: () => <div data-testid="drawer">drawer</div>,
    }));
    vi.doMock("../components/LiTEmptyState", () => ({ default: () => <div data-testid="empty-state">empty</div> }));
    vi.doMock("./MockStudioHeader", () => ({ default: () => <div data-testid="mock-header">header</div> }));
    vi.doMock("../context/VoiceSessionContext", () => ({
      VoiceSessionContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
      defaultCtx: {} as never,
    }));
    vi.doMock("../stores/useStudioAgentStore", () => ({
      useStudioAgentStore: { setState: () => {}, getState: () => ({}) },
      AGENT_META: {
        litt: { id: "litt", displayName: "LiTT", color: "#22d3ee", tag: "Operating", role: "Operating", placeholder: "", systemPrompt: "" },
        spark: { id: "spark", displayName: "Spark", color: "#f472b6", tag: "Creative", role: "Creative", placeholder: "", systemPrompt: "" },
      },
    }));
    vi.doMock("../stores/useStudioModelStore", () => ({ useStudioModelStore: { setState: () => {}, getState: () => ({}) } }));
    vi.doMock("@/stores/useTerminalStore", () => ({ useTerminalStore: { setState: () => {}, getState: () => ({}), subscribe: () => () => {} } }));
    vi.doMock("@/context/ThemeContext", () => ({ useTheme: () => ({ tokens: { background: "#000", text: "#fff" } }) }));

    const { default: VisualTestPage } = await import("./page");
    await act(async () => { render(<VisualTestPage />); });
    expect(screen.getByText(/404/)).toBeTruthy();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders the harness when dev + VISUAL_TEST=1", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_VISUAL_TEST", "1");
    vi.resetModules();
    vi.doMock("../components/StudioTranscript", () => ({ default: () => <div data-testid="transcript">transcript</div> }));
    vi.doMock("../components/CommandComposer", () => ({ default: () => <div data-testid="composer">composer</div> }));
    vi.doMock("../components/StudioWorkspaceFrame", () => ({
      StudioInspector: () => <div data-testid="inspector">inspector</div>,
      StudioDrawer: () => <div data-testid="drawer">drawer</div>,
    }));
    vi.doMock("../components/LiTEmptyState", () => ({ default: () => <div data-testid="empty-state">empty</div> }));
    vi.doMock("./MockStudioHeader", () => ({ default: () => <div data-testid="mock-header">header</div> }));
    vi.doMock("../context/VoiceSessionContext", () => ({
      VoiceSessionContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
      defaultCtx: {} as never,
    }));
    vi.doMock("../stores/useStudioAgentStore", () => ({
      useStudioAgentStore: { setState: () => {}, getState: () => ({}) },
      AGENT_META: {
        litt: { id: "litt", displayName: "LiTT", color: "#22d3ee", tag: "Operating", role: "Operating", placeholder: "", systemPrompt: "" },
        spark: { id: "spark", displayName: "Spark", color: "#f472b6", tag: "Creative", role: "Creative", placeholder: "", systemPrompt: "" },
      },
    }));
    vi.doMock("../stores/useStudioModelStore", () => ({ useStudioModelStore: { setState: () => {}, getState: () => ({}) } }));
    vi.doMock("@/stores/useTerminalStore", () => ({ useTerminalStore: { setState: () => {}, getState: () => ({}), subscribe: () => () => {} } }));
    vi.doMock("@/context/ThemeContext", () => ({ useTheme: () => ({ tokens: { background: "#000", text: "#fff" } }) }));

    const { default: VisualTestPage } = await import("./page");
    await act(async () => { render(<VisualTestPage />); });
    const selector = screen.queryByTestId("visual-test-state-selector");
    expect(selector).toBeTruthy();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
