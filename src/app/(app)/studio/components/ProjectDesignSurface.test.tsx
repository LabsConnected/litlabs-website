/**
 * ProjectDesignSurface — the Canvas & Design stage's project surface.
 *
 * Regression contract for the 2026-11-20 walkthrough defects:
 *  - "Canvas renders blank": the stage must show the project's page
 *    structure (from its files) alongside the preview.
 *  - "Design is dead": Design mode must mount the real element
 *    inspector for the current selection — previously the mode never
 *    reached this surface and ElementInspectorPanel was rendered
 *    nowhere in the app.
 *
 * StudioPreviewPanel and ProjectStructurePanel are stubbed (their own
 * suites cover them); the REAL ElementInspectorPanel + useElementEdits
 * write path run against a stubbed workspace files API.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ProjectDesignSurface } from "./ProjectDesignSurface";
import type { PreviewSelection } from "./StudioPreviewPanel";

const { TREE_SELECTION } = vi.hoisted(() => ({
  TREE_SELECTION: {
    label: "Heading",
    selector: "#hero-title",
    tagName: "h1",
    attrs: { id: "hero-title" },
    styles: { color: "rgb(255, 255, 255)", "font-size": "48px" },
    text: "Hello world",
    path: "html > body > main > section > h1",
  } as PreviewSelection,
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: async () => "tok" }),
}));

vi.mock("../context/StudioContext", () => ({
  useStudioContext: () => ({ projectId: "p1", selection: null }),
}));

vi.mock("../hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({
    capabilities: {
      projectName: "Test Site",
      repositoryName: null,
      activeBranch: null,
      sourceKind: "managed",
      sourceStatus: "ready",
      versionControl: null,
    },
  }),
}));

vi.mock("../hooks/useProjectRuntime", () => ({
  useProjectRuntime: () => ({
    loading: false,
    error: null,
    state: { projectId: "p1", phase: "ready", workspaceStatus: "ready" },
    refresh: vi.fn(async () => undefined),
  }),
}));

vi.mock("./StudioPreviewPanel", () => ({
  default: (props: {
    inspectorTool?: string;
    onSelectionChange?: (s: PreviewSelection | null) => void;
  }) => (
    <div data-testid="preview-stub" data-tool={props.inspectorTool}>
      <button
        type="button"
        data-testid="preview-emit-selection"
        onClick={() => props.onSelectionChange?.(TREE_SELECTION)}
      >
        emit selection
      </button>
    </div>
  ),
}));

vi.mock("./ProjectStructurePanel", () => ({
  ProjectStructurePanel: (props: { onSelect: (s: PreviewSelection) => void }) => (
    <div data-testid="structure-stub">
      <button
        type="button"
        data-testid="structure-emit-selection"
        onClick={() => props.onSelect(TREE_SELECTION)}
      >
        pick h1
      </button>
    </div>
  ),
}));

const INDEX_HTML = `<!DOCTYPE html>
<html><body>
  <main><section class="hero"><h1 id="hero-title">Hello world</h1></section></main>
</body></html>`;

function stubWorkspace() {
  const written: { path?: string; content?: string }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/files") && !init) {
      return { ok: true, json: async () => ({ entries: [{ name: "index.html", type: "file" }] }) } as Response;
    }
    if (url.endsWith("/files") && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      if (body.action === "read") {
        return { ok: true, json: async () => ({ content: INDEX_HTML }) } as Response;
      }
      if (body.action === "write") {
        written.push({ path: body.path, content: body.content });
        return { ok: true, json: async () => ({ saved: true }) } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return written;
}

describe("ProjectDesignSurface — Canvas & Design stage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("build mode: shows the page structure and the preview, no inspector column", async () => {
    stubWorkspace();
    render(<ProjectDesignSurface mode="build" />);
    expect(await screen.findByTestId("structure-stub")).toBeInTheDocument();
    expect(screen.getByTestId("preview-stub")).toHaveAttribute("data-tool", "edit");
    expect(screen.queryByTestId("design-inspector-column")).not.toBeInTheDocument();
  });

  it("design mode: forces the select tool and shows the inspector empty state before any selection", async () => {
    stubWorkspace();
    render(<ProjectDesignSurface mode="design" />);
    expect(await screen.findByTestId("design-inspector-empty")).toBeInTheDocument();
    expect(screen.getByTestId("preview-stub")).toHaveAttribute("data-tool", "select");
    expect(screen.queryByTestId("element-inspector-panel")).not.toBeInTheDocument();
  });

  it("design mode: selecting from the page structure mounts the real inspector, resolved to the project file", async () => {
    stubWorkspace();
    const onPreviewSelectionChange = vi.fn();
    render(<ProjectDesignSurface mode="design" onPreviewSelectionChange={onPreviewSelectionChange} />);
    await userEvent.click(await screen.findByTestId("structure-emit-selection"));

    // The real ElementInspectorPanel mounts and resolves the element
    // to index.html through the real write path.
    expect(await screen.findByTestId("element-inspector-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("element-edit-color")).toBeInTheDocument();
    expect(screen.getByTestId("element-edit-status")).toHaveTextContent("index.html");
    // The selection also flows up to CommandStudio's sink, unchanged.
    expect(onPreviewSelectionChange).toHaveBeenCalledWith(TREE_SELECTION);
  });

  it("design mode: a selection clicked in the preview opens the same inspector", async () => {
    stubWorkspace();
    render(<ProjectDesignSurface mode="design" />);
    await userEvent.click(await screen.findByTestId("preview-emit-selection"));
    expect(await screen.findByTestId("element-inspector-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("element-edit-color")).toBeInTheDocument();
  });
});
