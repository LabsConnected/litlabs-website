import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { boardProjectTypeForWorkspaceType, useBoardProjectType } from "./useBoardProjectType";

describe("boardProjectTypeForWorkspaceType", () => {
  it("maps the game workspace types to the game board set", () => {
    expect(boardProjectTypeForWorkspaceType("game2d")).toBe("game");
    expect(boardProjectTypeForWorkspaceType("game3d")).toBe("game");
  });

  it("maps everything else — including unknown values — to website", () => {
    for (const value of ["website", "html", "app", "component", "bogus", "", null, undefined, 42]) {
      expect(boardProjectTypeForWorkspaceType(value)).toBe("website");
    }
  });
});

describe("useBoardProjectType", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a game project from the stored workspaceType", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ project: { workspaceType: "game3d" } }),
      })),
    );
    const { result } = renderHook(() => useBoardProjectType("project-game"));
    await waitFor(() => expect(result.current).toBe("game"));
  });

  it("resolves a website project from the stored workspaceType", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ project: { workspaceType: "website" } }),
      })),
    );
    const { result } = renderHook(() => useBoardProjectType("project-site"));
    expect(result.current).toBe("website");
  });

  it("stays on the website default when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { result } = renderHook(() => useBoardProjectType("project-x"));
    // Give the rejected fetch a tick to settle; the default must stand.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBe("website");
  });

  it("does not fetch without a project", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBoardProjectType(null));
    expect(result.current).toBe("website");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
