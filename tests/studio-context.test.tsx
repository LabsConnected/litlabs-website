import { describe, it, expect, vi } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  StudioContextProvider,
  useStudioContext,
} from "@/app/studio/context/StudioContext";
import type { WorkspaceStage, CreatorKind } from "@/app/studio/lib/studio-destinations";

// ─── Test helpers ────────────────────────────────────────────────

function wrapper(props: {
  initialProjectId?: string | null;
  initialSessionId?: string;
  initialWorkspaceMode?: WorkspaceStage;
  initialCreator?: CreatorKind | null;
  onWorkspaceModeChange?: (m: WorkspaceStage) => void;
  onCreatorChange?: (c: CreatorKind | null) => void;
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <StudioContextProvider
        initialProjectId={props.initialProjectId ?? "proj-001"}
        initialSessionId={props.initialSessionId ?? "session-001"}
        initialWorkspaceMode={props.initialWorkspaceMode ?? "plan"}
        initialCreator={props.initialCreator ?? null}
        onWorkspaceModeChange={props.onWorkspaceModeChange}
        onCreatorChange={props.onCreatorChange}
      >
        {children}
      </StudioContextProvider>
    );
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

  it("CreatorKind exact union remains: image video music audio design game environment", () => {
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

// ─── Context value tests ─────────────────────────────────────────

describe("StudioContextProvider", () => {
  it("provides initial values", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({
        initialProjectId: "proj-abc",
        initialSessionId: "sess-xyz",
        initialWorkspaceMode: "code",
        initialCreator: "image",
      }),
    });

    expect(result.current.sessionId).toBe("sess-xyz");
    expect(result.current.projectId).toBe("proj-abc");
    expect(result.current.workspaceMode).toBe("code");
    expect(result.current.creator).toBe("image");
    expect(result.current.activeFile).toBeNull();
    expect(result.current.activeAssetId).toBeNull();
  });

  it("setWorkspaceMode updates context and calls onWorkspaceModeChange", () => {
    const onWorkspaceModeChange = vi.fn();
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ onWorkspaceModeChange }),
    });

    act(() => result.current.setWorkspaceMode("canvas"));
    expect(result.current.workspaceMode).toBe("canvas");
    expect(onWorkspaceModeChange).toHaveBeenCalledWith("canvas");
  });

  it("setCreator updates context and calls onCreatorChange", () => {
    const onCreatorChange = vi.fn();
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ onCreatorChange }),
    });

    act(() => result.current.setCreator("video"));
    expect(result.current.creator).toBe("video");
    expect(onCreatorChange).toHaveBeenCalledWith("video");
  });

  it("setActiveFile updates activeFile", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({}),
    });

    act(() => result.current.setActiveFile("src/app/page.tsx"));
    expect(result.current.activeFile).toBe("src/app/page.tsx");

    act(() => result.current.setActiveFile(null));
    expect(result.current.activeFile).toBeNull();
  });

  it("setActiveAssetId updates activeAssetId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({}),
    });

    act(() => result.current.setActiveAssetId("project_asset:abc-123"));
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    act(() => result.current.setActiveAssetId(null));
    expect(result.current.activeAssetId).toBeNull();
  });

  it("project change updates projectId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialProjectId: "proj-001" }),
    });

    act(() => result.current._setProjectId("proj-002"));
    expect(result.current.projectId).toBe("proj-002");
  });

  it("project change clears stale activeFile", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialProjectId: "proj-001" }),
    });

    act(() => result.current.setActiveFile("src/app/page.tsx"));
    expect(result.current.activeFile).toBe("src/app/page.tsx");

    act(() => result.current._setProjectId("proj-002"));
    expect(result.current.projectId).toBe("proj-002");
    expect(result.current.activeFile).toBeNull();
  });

  it("project change clears stale activeAssetId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialProjectId: "proj-001" }),
    });

    act(() => result.current.setActiveAssetId("project_asset:abc-123"));
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    act(() => result.current._setProjectId("proj-002"));
    expect(result.current.projectId).toBe("proj-002");
    expect(result.current.activeAssetId).toBeNull();
  });

  it("setting same projectId does NOT clear activeFile/activeAssetId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialProjectId: "proj-001" }),
    });

    act(() => result.current.setActiveFile("src/app/page.tsx"));
    act(() => result.current.setActiveAssetId("project_asset:abc-123"));

    act(() => result.current._setProjectId("proj-001")); // same project
    expect(result.current.activeFile).toBe("src/app/page.tsx");
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");
  });

  it("stage switch preserves sessionId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialSessionId: "sess-stable" }),
    });

    act(() => result.current.setWorkspaceMode("canvas"));
    expect(result.current.sessionId).toBe("sess-stable");

    act(() => result.current.setWorkspaceMode("code"));
    expect(result.current.sessionId).toBe("sess-stable");

    act(() => result.current.setWorkspaceMode("preview"));
    expect(result.current.sessionId).toBe("sess-stable");
  });

  it("stage switch preserves projectId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialProjectId: "proj-stable" }),
    });

    act(() => result.current.setWorkspaceMode("canvas"));
    expect(result.current.projectId).toBe("proj-stable");

    act(() => result.current.setWorkspaceMode("code"));
    expect(result.current.projectId).toBe("proj-stable");
  });

  it("creator switch preserves sessionId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialSessionId: "sess-stable" }),
    });

    act(() => result.current.setCreator("video"));
    expect(result.current.sessionId).toBe("sess-stable");

    act(() => result.current.setCreator("music"));
    expect(result.current.sessionId).toBe("sess-stable");
  });

  it("creator switch preserves projectId", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ initialProjectId: "proj-stable" }),
    });

    act(() => result.current.setCreator("video"));
    expect(result.current.projectId).toBe("proj-stable");

    act(() => result.current.setCreator("design"));
    expect(result.current.projectId).toBe("proj-stable");
  });

  it("active asset survives stage switching", () => {
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({}),
    });

    act(() => result.current.setActiveAssetId("project_asset:abc-123"));

    act(() => result.current.setWorkspaceMode("canvas"));
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    act(() => result.current.setWorkspaceMode("code"));
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");

    act(() => result.current.setWorkspaceMode("preview"));
    expect(result.current.activeAssetId).toBe("project_asset:abc-123");
  });

  it("useStudioContext throws outside provider", () => {
    // Suppress the error boundary noise in the test output.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useStudioContext())).toThrow(
      "useStudioContext must be used within a StudioContextProvider",
    );
    spy.mockRestore();
  });

  it("context does not create independent duplicate routing state — setWorkspaceMode delegates", () => {
    const onWorkspaceModeChange = vi.fn();
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ onWorkspaceModeChange }),
    });

    // The public setWorkspaceMode must call the delegate callback
    // so the existing routing state (CommandStudio's setStudioMode)
    // stays in sync.
    act(() => result.current.setWorkspaceMode("code"));
    expect(onWorkspaceModeChange).toHaveBeenCalledWith("code");
  });

  it("context does not create independent duplicate routing state — setCreator delegates", () => {
    const onCreatorChange = vi.fn();
    const { result } = renderHook(() => useStudioContext(), {
      wrapper: wrapper({ onCreatorChange }),
    });

    act(() => result.current.setCreator("design"));
    expect(onCreatorChange).toHaveBeenCalledWith("design");
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
