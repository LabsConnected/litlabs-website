import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStudioProjectStore } from "@/app/studio/stores/useStudioProjectStore";

describe("useStudioProjectStore", () => {
  beforeEach(() => {
    // Reset store state
    useStudioProjectStore.setState({
      currentProjectId: null,
      loading: false,
      error: null,
    });
    // Clear localStorage
    try {
      localStorage.removeItem("litt:active-project-id");
    } catch {
      // ignore
    }
    // Clear URL
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with null project ID when no URL or localStorage", () => {
    const { result } = renderHook(() => useStudioProjectStore());
    expect(result.current.currentProjectId).toBeNull();
  });

  it("selectProject sets currentProjectId and persists to localStorage", () => {
    const { result } = renderHook(() => useStudioProjectStore());

    act(() => {
      result.current.selectProject("proj-123");
    });

    expect(result.current.currentProjectId).toBe("proj-123");
    expect(localStorage.getItem("litt:active-project-id")).toBe("proj-123");
  });

  it("clearProject removes from localStorage and state", () => {
    const { result } = renderHook(() => useStudioProjectStore());

    act(() => {
      result.current.selectProject("proj-456");
    });
    expect(result.current.currentProjectId).toBe("proj-456");

    act(() => {
      result.current.clearProject();
    });
    expect(result.current.currentProjectId).toBeNull();
    expect(localStorage.getItem("litt:active-project-id")).toBeNull();
  });

  it("setLoading and setError update state", () => {
    const { result } = renderHook(() => useStudioProjectStore());

    act(() => {
      result.current.setLoading(true);
      result.current.setError("Something went wrong");
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe("Something went wrong");
  });

  it("selectProject(null) clears localStorage", () => {
    const { result } = renderHook(() => useStudioProjectStore());

    act(() => {
      result.current.selectProject("proj-789");
    });
    expect(localStorage.getItem("litt:active-project-id")).toBe("proj-789");

    act(() => {
      result.current.selectProject(null);
    });
    expect(result.current.currentProjectId).toBeNull();
    expect(localStorage.getItem("litt:active-project-id")).toBeNull();
  });
});
