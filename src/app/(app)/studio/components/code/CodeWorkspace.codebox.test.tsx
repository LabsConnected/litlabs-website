import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ConnectionCapabilities } from "../../hooks/useConnectionSummary";
import { CodeWorkspace } from "./CodeWorkspace";

/**
 * Code as ONE box (spec 2026-11-16 §1 + Amendment 4): CodeWorkspace
 * composes Explorer | editor | preview region simultaneously, renders
 * the ONE shared preview element (or the pointer card supplied by the
 * bindings) in its preview region — never its own StudioPreviewPanel —
 * and hosts Plan and Canvas / Design as internal views.
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

describe("CodeWorkspace — one box (Code-box build)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("composes Explorer, editor and the preview region side by side, with the pointer card when the preview lives in the Preview panel", async () => {
    mockFilesFetch();
    render(
      <CodeWorkspace
        {...baseProps}
        previewPlaceholder={<div data-testid="preview-pointer-card">Preview is showing in the Preview panel</div>}
      />,
    );
    expect(screen.getByTestId("code-box-code-view")).toBeTruthy();
    // Explorer region (the file tree loads).
    await screen.findByText("index.html");
    // Preview region renders the supplied pointer card, not a preview.
    const region = screen.getByTestId("code-preview-region");
    expect(region.contains(screen.getByTestId("preview-pointer-card"))).toBe(true);
    expect(screen.queryByTestId("code-preview-unavailable")).toBeNull();
  });

  it("renders the ONE shared preview element in the preview region when Code is its home", async () => {
    mockFilesFetch();
    render(
      <CodeWorkspace
        {...baseProps}
        previewContent={<div data-testid="shared-preview-element" />}
        previewPlaceholder={<div data-testid="preview-pointer-card" />}
      />,
    );
    await screen.findByText("index.html");
    const region = screen.getByTestId("code-preview-region");
    expect(region.contains(screen.getByTestId("shared-preview-element"))).toBe(true);
    // The element wins over the pointer card — exactly one home shows it.
    expect(screen.queryByTestId("preview-pointer-card")).toBeNull();
  });

  it("Plan and Canvas / Design are reachable as views inside the Code box", async () => {
    mockFilesFetch();
    render(
      <CodeWorkspace
        {...baseProps}
        previewPlaceholder={<div data-testid="preview-pointer-card" />}
        canvasContent={<div data-testid="canvas-design-content" />}
        planCapabilities={{} as unknown as ConnectionCapabilities}
        planModelLabel="test-model"
      />,
    );
    await screen.findByText("index.html");
    expect(screen.getByTestId("code-box-view-tabs")).toBeTruthy();

    fireEvent.click(screen.getByTestId("code-box-view-plan"));
    expect(await screen.findByTestId("code-box-plan-view")).toBeTruthy();
    expect(await screen.findByTestId("studio-plan-surface")).toBeTruthy();
    expect(screen.queryByTestId("code-box-code-view")).toBeNull();

    fireEvent.click(screen.getByTestId("code-box-view-canvas-design"));
    expect(await screen.findByTestId("code-box-canvas-design-view")).toBeTruthy();
    expect(screen.getByTestId("canvas-design-content")).toBeTruthy();

    fireEvent.click(screen.getByTestId("code-box-view-code"));
    expect(screen.getByTestId("code-box-code-view")).toBeTruthy();
  });
});
