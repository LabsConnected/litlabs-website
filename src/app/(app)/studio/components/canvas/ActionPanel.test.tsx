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
