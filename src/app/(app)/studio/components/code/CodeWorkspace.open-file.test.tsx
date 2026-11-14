import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { STUDIO_EVENT_OPEN_FILE } from "@/lib/canvas/panel-actions";
import { CodeWorkspace } from "./CodeWorkspace";

/**
 * Panel linking (board B3): the Code workspace answers the same
 * studio:open-file event the Files panel dispatches when a file is
 * opened there, surfacing the file as an editor tab through the
 * existing openFile path. Events for other projects are ignored.
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
vi.mock("../StudioPreviewPanel", () => ({
  default: () => <div data-testid="studio-preview-panel" />,
}));
vi.mock("../StudioFilePreview", () => ({
  StudioFilePreview: () => <div data-testid="studio-file-preview" />,
}));

function mockFilesFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/files?path=")) {
      return new Response(
        JSON.stringify({ entries: [{ name: "index.html", type: "file", size: 12 }] }),
        { status: 200 },
      );
    }
    if (url.endsWith("/files") && init?.method === "POST") {
      return new Response(JSON.stringify({ content: "<h1>hi</h1>" }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

describe("CodeWorkspace — studio:open-file linking (B3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("opens the file as an editor tab when the Files panel dispatches open-file", async () => {
    const fetchMock = mockFilesFetch();
    render(
      <CodeWorkspace
        projectId="project-1"
        repositoryName="owner/repo"
        branch="main"
        workspaceStatus="ready"
        writeAccess
      />,
    );

    // The tree loads and no tab is open yet.
    await screen.findByText("index.html");
    expect(screen.getByText("No file open")).toBeTruthy();

    fireEvent(
      window,
      new CustomEvent(STUDIO_EVENT_OPEN_FILE, {
        detail: { projectId: "project-1", path: "index.html", source: "files-panel" },
      }),
    );

    await waitFor(() => expect(screen.queryByText("No file open")).toBeNull());
    const readCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/files") &&
        typeof init?.body === "string" &&
        init.body.includes('"action":"read"') &&
        init.body.includes("index.html"),
    );
    expect(readCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores open-file events for other projects", async () => {
    const fetchMock = mockFilesFetch();
    render(
      <CodeWorkspace
        projectId="project-1"
        repositoryName="owner/repo"
        branch="main"
        workspaceStatus="ready"
        writeAccess
      />,
    );

    await screen.findByText("index.html");
    fireEvent(
      window,
      new CustomEvent(STUDIO_EVENT_OPEN_FILE, {
        detail: { projectId: "another-project", path: "index.html" },
      }),
    );

    // No read is issued and the empty-tab state stands.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("No file open")).toBeTruthy();
    const readCalls = fetchMock.mock.calls.filter(
      ([, init]) => typeof init?.body === "string" && init.body.includes('"action":"read"'),
    );
    expect(readCalls).toHaveLength(0);
  });
});
