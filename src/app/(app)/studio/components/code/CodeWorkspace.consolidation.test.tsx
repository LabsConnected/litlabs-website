import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ConnectionCapabilities } from "../../hooks/useConnectionSummary";
import { STUDIO_EVENT_OPEN_CODE_VIEW } from "@/lib/canvas/panel-actions";
import { CodeWorkspace } from "./CodeWorkspace";

/**
 * Rail consolidation (Larry, 2026-11-25): when CommandStudio threads
 * the Files composition and the run-section contents into the Code
 * box, the box offers a Files view (Files' only home in Regular) and
 * a Run view (Plan · Checks · Approvals · Changes · Activity ·
 * Deploy), and external entry points can summon them via
 * STUDIO_EVENT_OPEN_CODE_VIEW. Mounts without the threaded content
 * keep exactly the original views.
 */

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<unknown>) => {
      const Lazy = React.lazy(() =>
        loader().then((resolved) => {
          const mod = resolved as Record<string, unknown>;
          const Comp = (
            typeof resolved === "function" ? resolved : (mod.default ?? Object.values(mod)[0])
          ) as React.ComponentType<Record<string, unknown>>;
          return { default: Comp };
        }),
      );
      return function DynamicPassthrough(props: Record<string, unknown>) {
        return React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(Lazy, props),
        );
      };
    },
  };
});

vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="monaco-editor" />,
}));
vi.mock("@/lib/monaco/setup", () => ({ configureBundledMonaco: () => {} }));
vi.mock("../StudioFilePreview", () => ({
  StudioFilePreview: () => <div data-testid="studio-file-preview" />,
}));
vi.mock("../StudioPlanSurface", () => ({
  default: () => <div data-testid="studio-plan-surface" />,
}));

function mockFilesFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/files?path=")) {
      return new Response(
        JSON.stringify({ entries: [{ name: "index.html", type: "file", size: 12 }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

const baseProps = {
  projectId: "project-1",
  repositoryName: "owner/repo",
  branch: "main",
  workspaceStatus: "ready",
  writeAccess: true,
};

const runContent = {
  checks: <div data-testid="run-checks-slot">checks</div>,
  approvals: <div data-testid="run-approvals-slot">approvals</div>,
  changes: <div data-testid="run-changes-slot">changes</div>,
  activity: <div data-testid="run-activity-slot">activity</div>,
  deploy: <div data-testid="run-deploy-slot">deploy</div>,
};

describe("CodeWorkspace — rail consolidation views", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("without threaded content there is no Files or Run view (board mount unchanged)", async () => {
    mockFilesFetch();
    render(<CodeWorkspace {...baseProps} />);
    await screen.findByText("index.html");
    expect(screen.queryByTestId("code-box-view-files")).toBeNull();
    expect(screen.queryByTestId("code-box-view-run")).toBeNull();
    expect(screen.getByTestId("code-box-view-plan")).toBeTruthy();
  });

  it("Files view hosts the threaded files composition", async () => {
    mockFilesFetch();
    render(
      <CodeWorkspace
        {...baseProps}
        filesContent={<div data-testid="files-composition">files</div>}
      />,
    );
    await screen.findByText("index.html");
    fireEvent.click(screen.getByTestId("code-box-view-files"));
    expect(screen.getByTestId("code-box-files-view")).toBeTruthy();
    expect(screen.getByTestId("files-composition")).toBeTruthy();
    expect(screen.queryByTestId("code-box-code-view")).toBeNull();
  });

  it("Run view folds Plan in as its first section and switches sections, keeping panes mounted", async () => {
    mockFilesFetch();
    render(
      <CodeWorkspace
        {...baseProps}
        runContent={runContent}
        planCapabilities={{} as unknown as ConnectionCapabilities}
        planModelLabel="test-model"
      />,
    );
    await screen.findByText("index.html");
    // The standalone Plan tab folds into Run when the run section exists.
    expect(screen.queryByTestId("code-box-view-plan")).toBeNull();
    fireEvent.click(screen.getByTestId("code-box-view-run"));
    expect(screen.getByTestId("code-box-run-view")).toBeTruthy();
    // Plan is the default section.
    expect(screen.getByTestId("code-run-pane-plan")).toHaveAttribute("data-active", "true");
    expect(await screen.findByTestId("studio-plan-surface")).toBeTruthy();

    fireEvent.click(screen.getByTestId("code-run-section-checks"));
    expect(screen.getByTestId("code-run-pane-checks")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("run-checks-slot")).toBeTruthy();
    // Other panes stay mounted (visibility pattern), including Plan.
    expect(screen.getByTestId("code-run-pane-deploy")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("run-deploy-slot")).toBeTruthy();

    fireEvent.click(screen.getByTestId("code-run-section-deploy"));
    expect(screen.getByTestId("code-run-pane-deploy")).toHaveAttribute("data-active", "true");
  });

  it("STUDIO_EVENT_OPEN_CODE_VIEW summons the Files view and a run section", async () => {
    mockFilesFetch();
    render(
      <CodeWorkspace
        {...baseProps}
        filesContent={<div data-testid="files-composition">files</div>}
        runContent={runContent}
        planCapabilities={{} as unknown as ConnectionCapabilities}
        planModelLabel="test-model"
      />,
    );
    await screen.findByText("index.html");

    fireEvent(
      window,
      new CustomEvent(STUDIO_EVENT_OPEN_CODE_VIEW, { detail: { view: "files" } }),
    );
    expect(screen.getByTestId("code-box-files-view")).toBeTruthy();

    fireEvent(
      window,
      new CustomEvent(STUDIO_EVENT_OPEN_CODE_VIEW, {
        detail: { view: "run", section: "approvals" },
      }),
    );
    expect(screen.getByTestId("code-box-run-view")).toBeTruthy();
    expect(screen.getByTestId("code-run-pane-approvals")).toHaveAttribute("data-active", "true");
  });

  it("STUDIO_EVENT_OPEN_CODE_VIEW is ignored for views this mount was not given", async () => {
    mockFilesFetch();
    render(<CodeWorkspace {...baseProps} />);
    await screen.findByText("index.html");
    fireEvent(
      window,
      new CustomEvent(STUDIO_EVENT_OPEN_CODE_VIEW, { detail: { view: "files" } }),
    );
    fireEvent(
      window,
      new CustomEvent(STUDIO_EVENT_OPEN_CODE_VIEW, {
        detail: { view: "run", section: "checks" },
      }),
    );
    // Still on the Code view — nothing was summoned.
    expect(screen.getByTestId("code-box-code-view")).toBeTruthy();
    expect(screen.queryByTestId("code-box-files-view")).toBeNull();
    expect(screen.queryByTestId("code-box-run-view")).toBeNull();
  });
});
