import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fs from "fs";
import * as path from "path";
import { ThemeProvider } from "@/context/ThemeContext";
import WorktabBar from "../WorktabBar";
import WorkspaceRail from "./WorkspaceRail";
import ContextInspector from "./ContextInspector";
import LiTTCommandLayer from "./LiTTCommandLayer";
import StudioOperatorBar from "./StudioOperatorBar";
import ContextDrawer from "../context/ContextDrawer";
import { useExecutionStore } from "../../stores/useExecutionStore";

/**
 * Shell-chrome theme compliance — the Studio shell's chrome (worktab
 * bar, workspace rail, inspector, LiTT command layer, operator bar,
 * classic context-drawer tab header) must follow the APPLIED theme
 * (useTheme tokens), in both directions. Regression contract for the
 * hard-coded-dark defect: these surfaces painted themselves with
 * near-black literals (rgba(13,9,22,*) / rgba(16,12,26,0.92)) that no
 * theme scope overrides, so under the light LiTT Signature theme the
 * worktab strip (and its sibling chrome) stayed dark charcoal while
 * the rest of Studio went light — with theme-scoped dark text on top.
 *
 * Themes are pinned via customColors so the expected token values are
 * exact and independent of the skin tables (same pattern as
 * tools/creator-theme.test.tsx).
 */

const LIGHT_THEME = {
  mode: "light",
  skin: "signature",
  accent: "signature-green",
  backgroundMode: "minimal",
  layoutStyle: "classic",
  customColors: {
    bgColor: "#ffffff",
    textColor: "#10240f",
    boxBg: "#eef5e9",
    borderColor: "#c9dcbf",
    accentColor: "#1d7a35",
    linkColor: "#1d7a35",
    headerColor: "#10240f",
  },
};

const DARK_THEME = {
  mode: "dark",
  skin: "volcanic",
  accent: "lime",
  backgroundMode: "nebula",
  layoutStyle: "classic",
  customColors: {
    bgColor: "#0a0a14",
    textColor: "#f2f2fa",
    boxBg: "#141424",
    borderColor: "#2c2c44",
    accentColor: "#a8ff2f",
    linkColor: "#a8ff2f",
    headerColor: "#f2f2fa",
  },
};

// tokens.surface ← boxBg; tokens.border ← borderColor.
const LIGHT_SURFACE = "rgb(238, 245, 233)";
const DARK_SURFACE = "rgb(20, 20, 36)";
const LIGHT_BORDER = "rgb(201, 220, 191)";

function seedTheme(theme: unknown) {
  localStorage.setItem("litlabs-theme", JSON.stringify(theme));
}

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

async function expectSurface(el: HTMLElement, rgb: string) {
  // ThemeProvider applies the stored theme after a rAF-gated mount.
  await waitFor(() => expect(el.style.backgroundColor).toBe(rgb));
}

const TAB = {
  id: "tab-a",
  title: "Homepage",
  conversationId: "conv-a",
  surface: "studio/preview",
  selection: null,
  createdAt: 1,
};

function worktabBar(closedTabs: { id: string; title: string }[] = []) {
  return (
    <WorktabBar
      tabs={[TAB]}
      activeId="tab-a"
      badges={{}}
      onSwitch={vi.fn()}
      onClose={vi.fn()}
      onNew={vi.fn()}
      closedTabs={closedTabs}
      onReopen={vi.fn()}
    />
  );
}

function contextDrawer() {
  return (
    <ContextDrawer
      open
      activeTab="files"
      onTabChange={vi.fn()}
      onClose={vi.fn()}
      filesContent={<div>files</div>}
      assetsContent={<div>assets</div>}
      inspectorContent={<div>inspector</div>}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useExecutionStore.getState().reset();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({}), { status: 200 }),
  );
});

describe("shell chrome follows the applied theme", () => {
  it("WorktabBar root renders the applied LIGHT theme (not hard-coded dark)", async () => {
    seedTheme(LIGHT_THEME);
    renderWithTheme(worktabBar());
    await expectSurface(screen.getByTestId("worktab-bar"), LIGHT_SURFACE);
  });

  it("WorktabBar root renders the applied DARK theme (both directions)", async () => {
    seedTheme(DARK_THEME);
    renderWithTheme(worktabBar());
    await expectSurface(screen.getByTestId("worktab-bar"), DARK_SURFACE);
  });

  it("WorktabBar reopen menu follows the theme (surface + border tokens)", async () => {
    seedTheme(LIGHT_THEME);
    const user = userEvent.setup();
    renderWithTheme(worktabBar([{ id: "tab-c", title: "Old work" }]));
    await expectSurface(screen.getByTestId("worktab-bar"), LIGHT_SURFACE);
    await user.click(screen.getByTestId("worktab-reopen-toggle"));
    const menu = screen.getByTestId("worktab-reopen-menu");
    expect(menu.style.backgroundColor).toBe(LIGHT_SURFACE);
    expect(menu.style.borderColor).toBe(LIGHT_BORDER);
  });

  it("WorkspaceRail renders the applied LIGHT theme", async () => {
    seedTheme(LIGHT_THEME);
    renderWithTheme(<WorkspaceRail active="preview" onSelect={vi.fn()} />);
    await expectSurface(screen.getByTestId("studio-workspace-rail"), LIGHT_SURFACE);
  });

  it("WorkspaceRail renders the applied DARK theme", async () => {
    seedTheme(DARK_THEME);
    renderWithTheme(<WorkspaceRail active="preview" onSelect={vi.fn()} />);
    await expectSurface(screen.getByTestId("studio-workspace-rail"), DARK_SURFACE);
  });

  it("ContextInspector panel + collapsed strip render the applied LIGHT theme", async () => {
    seedTheme(LIGHT_THEME);
    const { rerender } = renderWithTheme(
      <ContextInspector
        open
        onToggle={vi.fn()}
        selection={null}
        onAskAboutSelection={vi.fn()}
        onClearSelection={vi.fn()}
        propertiesContent={null}
        defaultContent={<div>plan</div>}
      />,
    );
    await expectSurface(screen.getByTestId("studio-context-inspector"), LIGHT_SURFACE);
    rerender(
      <ThemeProvider>
        <ContextInspector
          open={false}
          onToggle={vi.fn()}
          selection={null}
          onAskAboutSelection={vi.fn()}
          onClearSelection={vi.fn()}
          propertiesContent={null}
          defaultContent={<div>plan</div>}
        />
      </ThemeProvider>,
    );
    await expectSurface(screen.getByTestId("studio-inspector-open"), LIGHT_SURFACE);
  });

  it("LiTTCommandLayer renders the applied LIGHT theme", async () => {
    seedTheme(LIGHT_THEME);
    renderWithTheme(
      <LiTTCommandLayer
        storageKey="test"
        busy={false}
        expanded={false}
        onExpandedChange={vi.fn()}
        transcript={<div>transcript</div>}
        composer={<div>composer</div>}
        statusBar={<div>status</div>}
      />,
    );
    await expectSurface(screen.getByTestId("litt-command-layer"), LIGHT_SURFACE);
  });

  it("StudioOperatorBar renders the applied LIGHT theme (surface + border tokens)", async () => {
    seedTheme(LIGHT_THEME);
    renderWithTheme(<StudioOperatorBar terminalStatus="Terminal ready" modelLabel="LiTT Auto" />);
    const bar = screen.getByTestId("studio-operator-bar");
    await expectSurface(bar, LIGHT_SURFACE);
    expect(bar.style.borderColor).toBe(LIGHT_BORDER);
  });

  it("StudioOperatorBar renders the applied DARK theme", async () => {
    seedTheme(DARK_THEME);
    renderWithTheme(<StudioOperatorBar terminalStatus="Terminal ready" modelLabel="LiTT Auto" />);
    await expectSurface(screen.getByTestId("studio-operator-bar"), DARK_SURFACE);
  });

  it("ContextDrawer tab header renders the applied LIGHT theme", async () => {
    seedTheme(LIGHT_THEME);
    renderWithTheme(contextDrawer());
    const tabButton = screen.getByRole("button", { name: "Files" });
    const header = tabButton.parentElement as HTMLElement;
    await expectSurface(header, LIGHT_SURFACE);
  });
});

describe("shell-chrome sources carry no hard-coded dark surface literals", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(__dirname, rel), "utf8");

  it("no rgba(13,9,22 / rgba(16,12,26 surface literals remain in the chrome files", () => {
    for (const rel of [
      "../WorktabBar.tsx",
      "./WorkspaceRail.tsx",
      "./ContextInspector.tsx",
      "./LiTTCommandLayer.tsx",
      "./StudioOperatorBar.tsx",
      "../context/ContextDrawer.tsx",
    ]) {
      const src = read(rel);
      expect(src, rel).not.toContain("rgba(13,9,22");
      expect(src, rel).not.toContain("rgba(16,12,26");
    }
  });
});
