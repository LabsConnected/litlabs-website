import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionInspectorPanel } from "./StudioInspector";
import { STUDIO_EVENT_OPEN_FILE } from "@/lib/canvas/panel-actions";
import type { StudioSelectionPayload } from "../context/StudioContext";

const PAYLOAD: StudioSelectionPayload = {
  kind: "preview-element",
  label: "Hero heading",
  selector: "main > h1",
  tagName: "h1",
  sourceFile: "src/components/Hero.tsx",
  route: "/",
  projectId: "proj-1",
  timestamp: 1727,
};

describe("SelectionInspectorPanel (F1 slice C)", () => {
  let dispatched: Array<{ type: string; detail: unknown }>;

  beforeEach(() => {
    dispatched = [];
    window.dispatchEvent = ((event: Event) => {
      dispatched.push({
        type: event.type,
        detail: (event as CustomEvent).detail,
      });
      return true;
    }) as typeof window.dispatchEvent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows an honest empty state when nothing is selected", () => {
    render(<SelectionInspectorPanel selection={null} />);
    expect(
      screen.getByText("Select an element in Preview or Canvas to inspect it."),
    ).toBeTruthy();
    // Never fake content: no provenance rows, no action buttons.
    expect(screen.queryByTestId("selection-inspector")).toBeNull();
  });

  it("renders provenance from a full payload", () => {
    render(
      <SelectionInspectorPanel selection={PAYLOAD} projectId="proj-1" />,
    );
    expect(screen.getByTestId("selection-inspector")).toBeTruthy();
    expect(screen.getByText("Hero heading")).toBeTruthy();
    expect(screen.getByText("src/components/Hero.tsx")).toBeTruthy();
    expect(screen.getByText("main > h1")).toBeTruthy();
    // Kind chip + element row.
    expect(screen.getAllByText("Preview").length).toBeGreaterThan(0);
  });

  it("Ask LiTT dispatches studio:ask-litt with the structured payload", () => {
    render(
      <SelectionInspectorPanel selection={PAYLOAD} projectId="proj-1" />,
    );
    fireEvent.click(screen.getByTestId("selection-inspector-ask-litt"));

    const ask = dispatched.find((d) => d.type === "studio:ask-litt");
    expect(ask).toBeTruthy();
    expect((ask!.detail as { selection: StudioSelectionPayload }).selection).toBe(
      PAYLOAD,
    );
  });

  it("Reveal in Code dispatches the open-file event with project + path", () => {
    render(
      <SelectionInspectorPanel selection={PAYLOAD} projectId="proj-1" />,
    );
    fireEvent.click(screen.getByTestId("selection-inspector-reveal"));

    const open = dispatched.find((d) => d.type === STUDIO_EVENT_OPEN_FILE);
    expect(open).toBeTruthy();
    expect(open!.detail).toEqual({
      projectId: "proj-1",
      path: "src/components/Hero.tsx",
    });
  });

  it("hides Reveal in Code when no source file is known", () => {
    render(
      <SelectionInspectorPanel
        selection={{ ...PAYLOAD, sourceFile: undefined }}
        projectId="proj-1"
      />,
    );
    expect(screen.queryByTestId("selection-inspector-reveal")).toBeNull();
  });

  it("Clear calls onClear", () => {
    const onClear = vi.fn();
    render(
      <SelectionInspectorPanel
        selection={PAYLOAD}
        projectId="proj-1"
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByTestId("selection-inspector-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("upgrades a legacy selection shape without crashing", () => {
    render(
      <SelectionInspectorPanel
        selection={{ elementId: "main > h1", content: "Hero" }}
        projectId="proj-1"
      />,
    );
    expect(screen.getByTestId("selection-inspector")).toBeTruthy();
    // Label appears in the header and (as content) in the provenance rows.
    expect(screen.getAllByText("Hero").length).toBeGreaterThan(0);
  });
});
