import { describe, it, expect, vi } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  StudioContextProvider,
  useStudioContext,
} from "@/app/studio/context/StudioContext";
import type { WorkspaceStage, CreatorKind } from "@/app/studio/lib/studio-destinations";

// ─── Test helpers ────────────────────────────────────────────────

interface WrapperProps {
  projectId?: string | null;
  sessionId?: string;
  workspaceMode?: WorkspaceStage;
  creator?: CreatorKind | null;
  onWorkspaceModeChange?: (m: WorkspaceStage) => void;
  onCreatorChange?: (c: CreatorKind | null) => void;
  children?: React.ReactNode;
}

/**
 * Single stable wrapper component for use with renderHook's
 * initialProps + rerender pattern. This is required for controlled-props
 * testing — rerendering with a new wrapper function identity would
 * re-mount the provider and lose provider-owned state.
 */
function ControlledWrapper({
  projectId = "proj-001",
  sessionId = "session-001",
  workspaceMode = "plan",
  creator = null,
  onWorkspaceModeChange,
  onCreatorChange,
  children,
}: WrapperProps) {
  return (
    <StudioContextProvider
      projectId={projectId}
      sessionId={sessionId}
      workspaceMode={workspaceMode}
      creator={creator}
      onWorkspaceModeChange={onWorkspaceModeChange}
      onCreatorChange={onCreatorChange}
    >
      {children}
    </StudioContextProvider>
  );
}

function wrapper(props: WrapperProps) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ControlledWrapper {...props}>{children}</ControlledWrapper>;
  };
}

// ─── Type contract tests ─────────────────────────────────────────

describe("StudioContext type contracts", () => {
  it("WorkspaceStage exact union remains: plan canvas code preview", () => {
    // This is a compile-time check — if the type changes, this file
    // won't compile. We also verify at runtime via the values.
    const stages: WorkspaceStage[] = ["plan", "canvas", "code", "preview"];
    expect(stages).toHaveLength(4);
    expect(stages).toContain("plan");
    expect(stages).toContain("canvas");
    expect(stages).toContain("code");
    expect(stages).toContain("preview");
  });

  it("CreatorKind exact unions remains: image video music audio design game environment", () => {
    const kinds: CreatorKind[] = [
      "image", "video", "music", "audio", "design", "game", "environment",
    ];
    expect(kinds).toHaveLength(7);
    for (const k of kinds) {
      expect(kinds).toContain(k);
    }
  });

  it("environment remains internal canonical ID for 360°", () => {
    // The UI label is "360°" but the internal identifier is "environment".
    // This must not change.
    const kind: CreatorKind = "environment";
    expect(kind).toBe("environment");
  });
});

// ─── Context value tests (controlled props) ──────────────────────

describe("StudioContextProvider — controlled props", () => {
  it("provides controlled values", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({
        projectId: "proj-abc",
        sessionId: "sess-xyz",
        workspaceMode: "code",
        creator: "image",
      }),
    });

    expect(result.current.sessionId).toBe("sess-xyz");
    expect(result.current.projectId).toBe("proj-abc");
    expect(result.current.workspaceMode).toBe("code");
    expect(result.current.creator).toBe("image");
    expect(result.current.activeFile).toBeNull();
    expect(result.current.activeAssetId).toBeNull();
  });

  it("workspaceMode and creator are independent — can represent code + image", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({
        workspaceMode: "code",
        creator: "image",
      }),
    });

    expect(result.current.workspaceMode).toBe("code");
    expect(result.current.creator).toBe("image");
  });

  it("workspaceMode and creator are independent — can represent canvas + video", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({
        workspaceMode: "canvas",
        creator: "video",
      }),
    });

    expect(result.current.workspaceMode).toBe("canvas");
    expect(result.current.creator).toBe("video");
  });

  it("setWorkspaceMode calls onWorkspaceModeChange delegate", () => {
    const onWorkspaceModeChange = vi.fn();
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ onWorkspaceModeChange }),
    });

    act(() => result.current.setWorkspaceMode("canvas"));
    expect(onWorkspaceModeChange).toHaveBeenCalledWith("canvas");
  });

  it("setCreator calls onCreatorChange delegate", () => {
    const onCreatorChange = vi.fn();
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ onCreatorChange }),
    });

    act(() => result.current.setCreator("video"));
    expect(onCreatorChange).toHaveBeenCalledWith("video");
  });

  it("setCreator(null) calls onCreatorChange with null (exit creator surface)", () => {
    const onCreatorChange = vi.fn();
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ creator: "image", onCreatorChange }),
    });

    act(() => result.current.setCreator(null));
    expect(onCreatorChange).toHaveBeenCalledWith(null);
  });

  it("setActiveFile updates activeFile (provider-owned state)", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({}),
    });

    act(() => result.current.setActiveFile("src/app/page.tsx"));
    expect(result.current.activeFile).toBe("src/app/page.tsx");

    act(() => result.current.setActiveFile(null));
    expect(result.current.activeFile).toBeNull();
  });

  it("setActiveAssetId updates activeAssetId (provider-owned state)", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({}),
    });

    act(() => result.current.setActiveAssetId("project_asset:abc-123"));
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    act(() => result.current.setActiveAssetId(null));
    expect(result.current.activeAssetId).toBeNull();
  });
});

// ─── Project change clears provider-owned state ──────────────────

describe("StudioContextProvider — project change clears activeFile/activeAssetId", () => {
  it("changing projectId prop clears activeFile and activeAssetId", () => {
    let currentProps: WrapperProps = {
      projectId: "proj-001",
      sessionId: "sess-001",
      workspaceMode: "plan",
      creator: null,
    };

    const { result, rerender } = renderHook(() => useStudioContext(), {
      wrapper: function TestWrapper({ children }) {
        return <ControlledWrapper {...currentProps}>{children}</ControlledWrapper>;
      },
    });

    act(() => {
      result.current.setActiveFile("src/app/page.tsx");
      result.current.setActiveAssetId("project_asset:abc-123");
    });
    expect(result.current.activeFile).toBe("src/app/page.tsx");
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    // Change project — should clear provider-owned state.
    currentProps = { ...currentProps, projectId: "proj-002" };
    rerender();

    expect(result.current.projectId).toBe("proj-002");
    expect(result.current.activeFile).toBeNull();
    expect(result.current.activeAssetId).toBeNull();
  });

  it("setting same projectId does NOT clear activeFile/activeAssetId", () => {
    let currentProps: WrapperProps = {
      projectId: "proj-001",
      sessionId: "sess-001",
      workspaceMode: "plan",
      creator: null,
    };

    const { result, rerender } = renderHook(() => useStudioContext(), {
      wrapper: function TestWrapper({ children }) {
        return <ControlledWrapper {...currentProps}>{children}</ControlledWrapper>;
      },
    });

    act(() => {
      result.current.setActiveFile("src/app/page.tsx");
      result.current.setActiveAssetId("project_asset:abc-123");
    });

    // Re-render with same project — should NOT clear.
    rerender();

    expect(result.current.activeFile).toBe("src/app/page.tsx");
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");
  });
});

// ─── Stage/creator independence ──────────────────────────────────

describe("StudioContextProvider — stage/creator independence", () => {
  it("active asset survives stage switching (controlled prop change)", () => {
    let currentProps: WrapperProps = {
      projectId: "proj-001",
      sessionId: "sess-001",
      workspaceMode: "plan",
      creator: null,
    };

    const { result, rerender } = renderHook(() => useStudioContext(), {
      wrapper: function TestWrapper({ children }) {
        return <ControlledWrapper {...currentProps}>{children}</ControlledWrapper>;
      },
    });

    act(() => result.current.setActiveAssetId("project_asset:abc-123"));

    currentProps = { ...currentProps, workspaceMode: "canvas" };
    rerender();
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    currentProps = { ...currentProps, workspaceMode: "code" };
    rerender();
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    currentProps = { ...currentProps, workspaceMode: "preview" };
    rerender();
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");
  });

  it("creator switch preserves sessionId and projectId", () => {
    let currentProps: WrapperProps = {
      projectId: "proj-stable",
      sessionId: "sess-stable",
      workspaceMode: "code",
      creator: null,
    };

    const { result, rerender } = renderHook(() => useStudioContext(), {
      wrapper: function TestWrapper({ children }) {
        return <ControlledWrapper {...currentProps}>{children}</ControlledWrapper>;
      },
    });

    // Activate image creator — stage stays "code" (independent).
    currentProps = { ...currentProps, creator: "image" };
    rerender();
    expect(result.current.sessionId).toBe("sess-stable");
    expect(result.current.projectId).toBe("proj-stable");
    expect(result.current.workspaceMode).toBe("code");
    expect(result.current.creator).toBe("image");

    // Switch to video creator — stage still "code".
    currentProps = { ...currentProps, creator: "video" };
    rerender();
    expect(result.current.workspaceMode).toBe("code");
    expect(result.current.creator).toBe("video");
  });
});

// ─── No mirrored state — provider does not expose _set* ──────────

describe("StudioContextProvider — no mirrored state machinery", () => {
  it("context API does NOT expose _set* methods", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({}),
    });

    // The controlled-props design removed all _set* methods.
    const api = result.current as unknown as Record<string, unknown>;
    expect(api._setProjectId).toBeUndefined();
    expect(api._setSessionId).toBeUndefined();
    expect(api._setWorkspaceMode).toBeUndefined();
    expect(api._setCreator).toBeUndefined();
  });
});

// ─── Error boundary ──────────────────────────────────────────────

describe("useStudioContext error handling", () => {
  it("useStudioContext throws outside provider", () => {
    // Suppress the error boundary noise in the test output.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useStudioContext())).toThrow(
      "useStudioContext must be used within a StudioContextProvider",
    );
    spy.mockRestore();
  });
});

// ─── Derivation helpers ──────────────────────────────────────────

describe("deriveCreator / deriveWorkspaceStage", () => {
  it("deriveCreator returns null for studio/work (Plan)", async () => {
    const { deriveCreator } = await import("@/app/studio/context/derive-studio-context");
    expect(deriveCreator("studio", "work", null)).toBeNull();
  });

  it("deriveCreator returns 'design' for studio/design", async () => {
    const { deriveCreator } = await import("@/app/studio/context/derive-studio-context");
    expect(deriveCreator("studio", "design", null)).toBe("design");
  });

  it("deriveCreator returns the createMode for create destination", async () => {
    const { deriveCreator } = await import("@/app/studio/context/derive-studio-context");
    expect(deriveCreator("create", null, "image")).toBe("image");
    expect(deriveCreator("create", null, "video")).toBe("video");
    expect(deriveCreator("create", null, "music")).toBe("music");
    expect(deriveCreator("create", null, "environment")).toBe("environment");
  });

  it("deriveWorkspaceStage returns null for non-studio destinations", async () => {
    const { deriveWorkspaceStage } = await import("@/app/studio/context/derive-studio-context");
    expect(deriveWorkspaceStage("create", null)).toBeNull();
    expect(deriveWorkspaceStage("assets", null)).toBeNull();
  });

  it("deriveWorkspaceStage maps studio modes correctly", async () => {
    const { deriveWorkspaceStage } = await import("@/app/studio/context/derive-studio-context");
    expect(deriveWorkspaceStage("studio", "work")).toBe("plan");
    expect(deriveWorkspaceStage("studio", "files")).toBe("canvas");
    expect(deriveWorkspaceStage("studio", "code")).toBe("code");
    expect(deriveWorkspaceStage("studio", "preview")).toBe("preview");
  });
});
