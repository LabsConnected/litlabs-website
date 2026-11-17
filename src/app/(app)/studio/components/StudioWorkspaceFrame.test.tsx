import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StudioInspector, type StudioInspectorData } from "./StudioWorkspaceFrame";
import type { InspectorTab } from "../lib/studio-destinations";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";

// The Inspector tab strip + content routing are what this suite pins. The
// heavy per-tab panels are stubbed so the test stays hermetic; the Browser
// jobs panel is stubbed too so its absence from the Inspector is provable
// (the component itself survives — it has a chat-side home and its own
// suite in StudioBrowserJobsPanel.test.tsx).
vi.mock("./StudioBrowserJobsPanel", () => ({
  default: () => <div data-testid="studio-browser-jobs-panel" />,
}));
vi.mock("./StudioHealthPanel", () => ({
  default: ({ mode }: { mode: string }) => <div data-testid={`studio-health-${mode}`} />,
}));
vi.mock("./RunChangesPanel", () => ({
  default: () => <div data-testid="run-changes-panel" />,
}));
vi.mock("./StudioProjectFiles", () => ({
  default: () => <div data-testid="studio-project-files" />,
}));
vi.mock("./StudioPreviewPanel", () => ({
  default: () => <div data-testid="studio-preview-panel" />,
}));
vi.mock("./StudioActivityPanel", () => ({
  StudioActivityPanel: () => <div data-testid="studio-activity-panel" />,
}));
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: async () => null }),
}));

function makeData(): StudioInspectorData {
  return {
    capabilities: {
      projectId: null,
      projectName: null,
      repositoryName: null,
      activeBranch: null,
      defaultBranch: null,
      workspaceStatus: null,
      writeAccess: false,
      sourceKind: null,
      sourceLabel: null,
      sourceStatus: null,
      versionControl: "none",
      githubConnected: false,
    } as unknown as ConnectionCapabilities,
    modelLabel: "Test model",
    activeAgentName: "LiTT",
    destination: "",
    surface: "",
    messages: [],
    busy: false,
    workspaceRevision: 0,
  };
}

function renderInspector(activeTab: InspectorTab, excludeTabs?: InspectorTab[]) {
  const onTabChange = vi.fn();
  const utils = render(
    <StudioInspector
      open
      onToggle={() => {}}
      activeTab={activeTab}
      onTabChange={onTabChange}
      data={makeData()}
      excludeTabs={excludeTabs}
    />,
  );
  return { onTabChange, ...utils };
}

function tabLabels(): string[] {
  return screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"))
    .filter((label): label is string => Boolean(label));
}

describe("StudioInspector tab strip (Browser tab retired, spec §4c)", () => {
  it("renders Plan · Changes · Files · Preview · Checks · Approvals and no Browser tab", () => {
    renderInspector("plan");
    for (const label of ["Plan", "Changes", "Files", "Preview", "Checks", "Approvals"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Browser" })).toBeNull();
    expect(tabLabels()).not.toContain("Browser");
  });

  it("with the board exclude list, the visible tabs are exactly Plan · Changes · Approvals", () => {
    renderInspector("plan", ["checks", "files", "preview"]);
    const labels = tabLabels();
    expect(labels).toContain("Plan");
    expect(labels).toContain("Changes");
    expect(labels).toContain("Approvals");
    expect(labels).not.toContain("Browser");
    expect(labels).not.toContain("Checks");
    expect(labels).not.toContain("Files");
    expect(labels).not.toContain("Preview");
  });

  it("clicking a remaining tab reports that tab", () => {
    const { onTabChange } = renderInspector("plan");
    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(onTabChange).toHaveBeenCalledWith("changes");
    fireEvent.click(screen.getByRole("button", { name: "Approvals" }));
    expect(onTabChange).toHaveBeenCalledWith("approvals");
  });
});

describe("StudioInspector content (remaining tabs still render)", () => {
  it("Plan renders the command center and never the browser jobs panel", () => {
    renderInspector("plan");
    expect(screen.getByText("Command center")).toBeTruthy();
    expect(screen.queryByTestId("studio-browser-jobs-panel")).toBeNull();
  });

  it("Changes renders the run changes panel", () => {
    renderInspector("changes");
    expect(screen.getByTestId("run-changes-panel")).toBeTruthy();
    expect(screen.queryByTestId("studio-browser-jobs-panel")).toBeNull();
  });

  it("Approvals renders the approvals health panel", () => {
    renderInspector("approvals");
    expect(screen.getByTestId("studio-health-approvals")).toBeTruthy();
    expect(screen.queryByTestId("studio-browser-jobs-panel")).toBeNull();
  });

  it("content container always uses the standard scroll padding (no browser-tab special case)", () => {
    renderInspector("plan");
    const region = screen.getByRole("region", { name: "plan inspector" });
    expect(region.className).toContain("overflow-y-auto");
    expect(region.className).toContain("p-2.5");
  });
});
