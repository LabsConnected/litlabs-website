/**
 * Project-context regression for the Assets destination (GalleryTool).
 *
 * Production audit ART-20261111-082: opening Assets from a project showed
 * "No project" and an empty bucket — the surface carried no project
 * identity and no way to select one. CommandStudio already passes
 * projectId into every workspace component; GalleryTool must consume it
 * and render the SHARED StudioProjectPicker (the same switcher as the
 * Studio header) so the active project is visible and changeable there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import GalleryTool from "../GalleryTool";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken }),
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: {
      accentColor: "#177a36",
      bgColor: "#ffffff",
      boxBg: "#ffffff",
      borderColor: "#cfdec4",
      textColor: "#0e1510",
      textMuted: "#63745f",
    },
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  cleanup();
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ items: [] }), { status: 200 }),
  );
});

describe("GalleryTool project context", () => {
  it("shows the shared project picker with the active project when wired", () => {
    render(
      <GalleryTool
        projectId="7ec1afdd-5d0e-48fb-b4c9-ae6430ec6643"
        projectName="Food Court"
        onProjectSelectAction={vi.fn()}
        onCreateProjectAction={vi.fn()}
      />,
    );

    const bar = screen.getByTestId("assets-project-bar");
    expect(bar).toBeTruthy();
    // The shared switcher (same component as the Studio header) shows the
    // project the user was in — not "Select project".
    expect(screen.getByTitle("Switch active project")).toBeTruthy();
    expect(bar.textContent).toContain("Food Court");
  });

  it("renders no picker when the surface is not wired to project selection", () => {
    render(<GalleryTool />);

    expect(screen.queryByTestId("assets-project-bar")).toBeNull();
    expect(screen.queryByTitle("Switch active project")).toBeNull();
    // The bucket itself still renders.
    expect(screen.getByText("Asset Bucket")).toBeTruthy();
  });
});
