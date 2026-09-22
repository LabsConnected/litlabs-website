/**
 * Tests for the ActionPanel ("What LiTT can do") sheet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionPanel } from "./ActionPanel";
import type { ArtifactAction } from "@/lib/canvas/types";

function mockReadiness(data: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(data)));
}

function renderPanel(props?: Partial<Parameters<typeof ActionPanel>[0]>) {
  const onClose = vi.fn();
  const onActionSelect = vi.fn();
  render(
    <ActionPanel
      open
      onClose={onClose}
      projectId="proj-123"
      onActionSelect={onActionSelect}
      {...props}
    />,
  );
  return { onClose, onActionSelect };
}

describe("ActionPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", () => {
    mockReadiness({ checkable: true, warnings: [] });
    const { container } = render(
      <ActionPanel open={false} onClose={vi.fn()} projectId="proj-123" onActionSelect={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the three actions once availability resolves", async () => {
    mockReadiness({ checkable: true, warnings: [] });
    renderPanel();
    await screen.findByText("Inspect element");
    expect(screen.getByText("Open terminal")).toBeTruthy();
    expect(screen.getByText("Publish site")).toBeTruthy();
  });

  it("filters by category pill", async () => {
    mockReadiness({ checkable: true, warnings: [] });
    renderPanel();
    await screen.findByText("Inspect element");
    fireEvent.click(screen.getByRole("tab", { name: "Deploy" }));
    expect(screen.queryByText("Inspect element")).toBeNull();
    expect(screen.getByText("Publish site")).toBeTruthy();
  });

  it("filters by search query", async () => {
    mockReadiness({ checkable: true, warnings: [] });
    renderPanel();
    await screen.findByText("Inspect element");
    fireEvent.change(screen.getByLabelText("Search actions"), { target: { value: "terminal" } });
    expect(screen.queryByText("Inspect element")).toBeNull();
    expect(screen.getByText("Open terminal")).toBeTruthy();
  });

  it("tapping a card fires onActionSelect with the action and closes", async () => {
    mockReadiness({ checkable: true, warnings: [] });
    const { onClose, onActionSelect } = renderPanel();
    await screen.findByText("Open terminal");
    fireEvent.click(screen.getByText("Open terminal"));
    await waitFor(() => {
      expect(onActionSelect).toHaveBeenCalledTimes(1);
    });
    const action = onActionSelect.mock.calls[0][0] as ArtifactAction;
    expect(action).toEqual({ type: "studio.open_terminal" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows Publish site disabled with the readiness reason when not ready", async () => {
    mockReadiness({
      checkable: true,
      warnings: [{ code: "missing-index", message: "No index.html at workspace root" }],
    });
    renderPanel();
    await screen.findByText("Publish site");
    const card = screen.getByText("Publish site").closest("button")!;
    expect(card.disabled).toBe(true);
    expect(card.title).toContain("No index.html");
  });

  it("pins recently used actions under Recent", async () => {
    mockReadiness({ checkable: true, warnings: [] });
    localStorage.setItem("litt-action-panel-recent", JSON.stringify(["open_terminal"]));
    const onActionSelect = vi.fn();
    render(
      <ActionPanel open onClose={vi.fn()} projectId="proj-123" onActionSelect={onActionSelect} />,
    );
    await screen.findByText("Recent");
    const recents = screen.getByText("Recent").parentElement!;
    expect(recents.textContent).toContain("Open terminal");
    expect(onActionSelect).not.toHaveBeenCalled();
  });

  it("records a selection into recents in localStorage", async () => {
    mockReadiness({ checkable: true, warnings: [] });
    renderPanel();
    await screen.findByText("Open terminal");
    fireEvent.click(screen.getByText("Open terminal"));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("litt-action-panel-recent")!)).toEqual([
        "open_terminal",
      ]);
    });
  });

  it("closes on Escape", async () => {
    mockReadiness({ checkable: true, warnings: [] });
    const { onClose } = renderPanel();
    await screen.findByText("Inspect element");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ActionPanel file tree drill-in", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Mock the readiness check plus per-directory file listings. */
  function mockFileApi(options?: { entries?: { name: string; type: "file" | "folder" }[] | null; error?: string }) {
    const { entries, error } = options ?? {};
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/files?path=")) {
        const dir = decodeURIComponent(url.split("/files?path=")[1] ?? ".");
        if (error !== undefined) {
          return new Response(JSON.stringify({ error }), { status: 500 });
        }
        const listing =
          entries ??
          (dir === "."
            ? [
                { name: "src", type: "folder" },
                { name: "index.html", type: "file" },
              ]
            : [{ name: "app.ts", type: "file" }]);
        return new Response(JSON.stringify({ entries: listing }));
      }
      return new Response(JSON.stringify({ checkable: true, warnings: [] }));
    });
  }

  it("shows the Browse files card", async () => {
    mockFileApi();
    renderPanel();
    await screen.findByText("Browse files");
  });

  it("tapping the Browse files card drills into the real file list", async () => {
    mockFileApi();
    renderPanel();
    await screen.findByText("Browse files");
    fireEvent.click(screen.getByText("Browse files"));
    // The card does not execute/close — it opens the drill-in view.
    await screen.findByText("index.html");
    expect(screen.getByLabelText("Project files")).toBeTruthy();
    expect(screen.getByText("src")).toBeTruthy();
  });

  it("drills into folders and back out", async () => {
    mockFileApi();
    const { onClose } = renderPanel();
    await screen.findByText("Browse files");
    fireEvent.click(screen.getByText("Browse files"));
    await screen.findByText("index.html");
    fireEvent.click(screen.getByLabelText("Open folder src"));
    await screen.findByText("app.ts");
    expect(screen.queryByText("index.html")).toBeNull();
    // Back to the parent directory.
    fireEvent.click(screen.getByLabelText("Back to project root"));
    await screen.findByText("index.html");
    // Back from the root returns to the action grid.
    fireEvent.click(screen.getByLabelText("Back to actions"));
    await screen.findByText("Open terminal");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tapping a file fires studio.open_file and closes the panel", async () => {
    mockFileApi();
    const { onClose, onActionSelect } = renderPanel();
    await screen.findByText("Browse files");
    fireEvent.click(screen.getByText("Browse files"));
    await screen.findByText("index.html");
    fireEvent.click(screen.getByLabelText("Open file index.html"));
    await waitFor(() => {
      expect(onActionSelect).toHaveBeenCalledTimes(1);
    });
    expect(onActionSelect.mock.calls[0][0]).toEqual({
      type: "studio.open_file",
      projectId: "proj-123",
      path: "index.html",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tapping a nested file passes the full relative path", async () => {
    mockFileApi();
    const { onActionSelect } = renderPanel();
    await screen.findByText("Browse files");
    fireEvent.click(screen.getByText("Browse files"));
    await screen.findByText("index.html");
    fireEvent.click(screen.getByLabelText("Open folder src"));
    await screen.findByText("app.ts");
    fireEvent.click(screen.getByLabelText("Open file src/app.ts"));
    await waitFor(() => {
      expect(onActionSelect).toHaveBeenCalledTimes(1);
    });
    expect(onActionSelect.mock.calls[0][0]).toEqual({
      type: "studio.open_file",
      projectId: "proj-123",
      path: "src/app.ts",
    });
  });

  it("shows a real error with a retry button when listing fails", async () => {
    mockFileApi({ error: "Workspace is not ready" });
    renderPanel();
    await screen.findByText("Browse files");
    fireEvent.click(screen.getByText("Browse files"));
    await screen.findByText("Workspace is not ready");
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("shows an empty state when the folder has no files", async () => {
    mockFileApi({ entries: [] });
    renderPanel();
    await screen.findByText("Browse files");
    fireEvent.click(screen.getByText("Browse files"));
    await screen.findByText("No files in this folder.");
  });

  it("records the browse into recents without closing", async () => {
    mockFileApi();
    const { onClose } = renderPanel();
    await screen.findByText("Browse files");
    fireEvent.click(screen.getByText("Browse files"));
    await screen.findByText("index.html");
    expect(JSON.parse(localStorage.getItem("litt-action-panel-recent")!)).toEqual([
      "browse_files",
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Browse files is disabled with a reason when no project is attached", async () => {
    mockFileApi();
    render(
      <ActionPanel open onClose={vi.fn()} projectId={null} onActionSelect={vi.fn()} />,
    );
    await screen.findByText("Browse files");
    const card = screen.getByText("Browse files").closest("button")!;
    expect(card.disabled).toBe(true);
    expect(card.title).toContain("Attach this canvas to a project first");
  });
});
