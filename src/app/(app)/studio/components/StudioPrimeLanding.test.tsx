/**
 * StudioPrimeLanding — theme + composition contract.
 *
 * Regression coverage for Larry's 2026-11-10 finding: the signed-in
 * Studio landing rendered as a hard-coded dark box even with the
 * light-locked LiTT Signature Appearance theme applied. The landing
 * (StudioPrimeLanding + the BuildConsole launcher + RecentWork list)
 * must consume the SAME Appearance theme tokens as every other themed
 * surface (useTheme().tokens — the mechanism /discover, the page
 * shells, and the #875 public pages use), and its composition must be
 * the centered, wider command-center layout from the approved
 * one-chat mockup — not a narrow column on a dark stage.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/context/ThemeContext";
import type { DashboardProject } from "@/components/dashboard/v3/types";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

const PROJECTS: DashboardProject[] = [
  {
    id: "repo-1",
    name: "LabsConnected/litlabs-website",
    type: "project",
    branch: "main",
    status: "failed",
    updatedAt: new Date().toISOString(),
    repository: "LabsConnected/litlabs-website",
    latestCommit: "77feed3a",
    deploymentState: "none",
    previewState: "failed",
    workspaceState: "failed",
    terminalState: "idle",
  },
  {
    id: "site-1",
    name: "After Midnight — Artist Launch Page",
    type: "project",
    branch: "main",
    status: "ready",
    updatedAt: new Date().toISOString(),
    repository: null,
    latestCommit: null,
    deploymentState: "none",
    previewState: "ready",
    workspaceState: "ready",
    terminalState: "idle",
  },
];

vi.mock("@/components/dashboard/v3/useDashboardData", () => ({
  useCanonicalProjects: () => ({ projects: PROJECTS, loading: false }),
}));

import StudioPrimeLanding from "./StudioPrimeLanding";

const SIGNATURE_THEME = {
  mode: "light",
  skin: "signature",
  accent: "signature-green",
  backgroundMode: "minimal",
  layoutStyle: "classic",
};

function renderLanding(theme?: Record<string, string>) {
  if (theme) localStorage.setItem("litlabs-theme", JSON.stringify(theme));
  return render(
    <ThemeProvider>
      <StudioPrimeLanding />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  pushMock.mockClear();
  vi.restoreAllMocks();
});

describe("StudioPrimeLanding theme", () => {
  it("renders LIGHT white-into-green when LiTT Signature is applied", async () => {
    renderLanding(SIGNATURE_THEME);
    const landing = screen.getByTestId("studio-prime-landing");
    // Signature bg token is true white (#FFFFFF).
    await waitFor(() =>
      expect(landing.style.backgroundColor).toBe("rgb(255, 255, 255)"),
    );
    // Launcher heading carries the Signature ink, not hard-coded white.
    const heading = screen.getByRole("heading", {
      name: /what do you want to make/i,
    });
    expect(heading.style.color).toBe("rgb(14, 21, 16)");
  });

  it("follows a dark theme instead of hard-coding either direction", async () => {
    // Explicit dark pick — the factory default is light-locked Signature
    // (#889), and the former volcanic/lime/nebula factory default migrates
    // to it, so a surviving dark render needs a non-legacy dark skin.
    renderLanding({
      mode: "dark",
      skin: "midnight",
      accent: "ocean-blue",
      backgroundMode: "minimal",
      layoutStyle: "classic",
    });
    const landing = screen.getByTestId("studio-prime-landing");
    await waitFor(() =>
      expect(landing.style.backgroundColor).toBe("rgb(8, 10, 18)"),
    );
    const heading = screen.getByRole("heading", {
      name: /what do you want to make/i,
    });
    expect(heading.style.color).toBe("rgb(199, 206, 232)");
  });
});

describe("StudioPrimeLanding composition", () => {
  it("centers a wide command-center column with chips and recent projects", async () => {
    const { container } = renderLanding(SIGNATURE_THEME);
    await waitFor(() =>
      expect(screen.getByTestId("studio-prime-landing").style.backgroundColor).toBe(
        "rgb(255, 255, 255)",
      ),
    );
    const column = container.querySelector("main > div");
    expect(column).not.toBeNull();
    expect(column!.className).toContain("mx-auto");
    expect(column!.className).toContain("max-w-6xl");

    // All seven creation-type chips, in place under the prompt.
    for (const label of [
      "Website",
      "Image",
      "Video",
      "Music",
      "Code",
      "Design",
      "Game",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    // Recent projects render in the same composition, repo row included.
    expect(screen.getByText("Recent projects")).toBeInTheDocument();
    expect(screen.getByText("LabsConnected/litlabs-website")).toBeInTheDocument();
    expect(
      screen.getByText("After Midnight — Artist Launch Page"),
    ).toBeInTheDocument();
  });

  it("chips keep the existing in-place starter routing", async () => {
    renderLanding(SIGNATURE_THEME);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Music" }));
    expect(pushMock).toHaveBeenCalledWith("/studio?creator=music");
  });
});

describe("Studio landing sources carry no hard-coded dark stage", () => {
  const surfaceFiles = [
    "src/app/(app)/studio/components/StudioPrimeLanding.tsx",
    "src/components/dashboard/v3/BuildConsole.tsx",
    "src/components/dashboard/v3/RecentWork.tsx",
  ];
  const banned = [
    "#0b120d", // landing's hard-coded deep-green stage
    "bg-black", // launcher input's black wash
    "rgba(18,18,21", // RecentWork dark panel / status chip
    "rgba(12,12,15", // RecentWork dark context menu
    "rgba(24,24,27", // RecentWork dark row hover
    "rgba(30,30,34", // RecentWork dark icon tile
    "rgba(38,52,18", // launcher's dark gradient stop
    "#fafafa", // hard-coded near-white text in RecentWork
    "#a1a1aa", // hard-coded zinc text in RecentWork
    "text-white", // hard-coded white text (launcher heading/input)
    "text-zinc-", // hard-coded zinc text utilities tuned for dark
  ];
  for (const rel of surfaceFiles) {
    it(`${rel} contains no hard-coded dark background or light text`, () => {
      const source = readFileSync(join(process.cwd(), rel), "utf8");
      for (const needle of banned) {
        expect(source, `${rel} still contains "${needle}"`).not.toContain(needle);
      }
    });
  }
});
