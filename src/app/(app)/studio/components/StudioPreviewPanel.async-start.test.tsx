import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";

// Async start (C3/C4): a start request that fails or times out in
// TRANSPORT — or answers an unshaped edge error while the server is
// still working — must NOT settle the panel to "failed". The
// terminal accepts the start and completes it in the background;
// the panel keeps polling and the start surfaces when it lands.
// Shaped failures (a payload carrying the runtime's own error) keep
// settling immediately — that behavior is covered by the recovery
// suite; this file covers only the transport class.

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

const HAS_CONTENT = { scaffolded: false, touched: true, starterContent: false };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(handler: Handler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return json(HAS_CONTENT);
    return (await handler(url, init)) ?? new Response("not found", { status: 404 });
  });
}

function panel(projectId: string) {
  return (
    <StudioPreviewPanel
      projectId={projectId}
      projectName="My new project"
      repositoryName={null}
      branch={null}
      workspaceStatus="ready"
      refreshKey={0}
    />
  );
}

const NOT_STARTED = { runtimeStatus: "not_started", previewUrl: null, runtimeError: null };
const STARTING = { runtimeStatus: "starting", previewUrl: null, runtimeError: null };
const readyFor = (id: string) => ({ runtimeStatus: "ready", previewUrl: `/api/preview/${id}/index.html`, runtimeError: null });
const isPost = (init?: RequestInit) => init?.method === "POST";
const isPreviewApi = (url: string) => /\/api\/studio-projects\/[^/]+\/preview$/.test(url);

describe("StudioPreviewPanel async start (C3/C4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("a start POST that rejects in transport does not settle failed — polling surfaces the start when it lands", async () => {
    let posted = false;
    let pollsAfterPost = 0;
    mockFetch((url, init) => {
      if (url.includes("/index.html")) return new Response("<h1>Fresh Bread</h1>", { status: 200 });
      if (!isPreviewApi(url)) return undefined;
      if (isPost(init)) {
        posted = true;
        // The edge killed the request; the server-side start lives on.
        return Promise.reject(new TypeError("network error"));
      }
      if (!posted) return json(NOT_STARTED);
      pollsAfterPost += 1;
      return json(pollsAfterPost < 2 ? STARTING : readyFor("project-a"));
    });
    render(panel("project-a"));

    // The panel rides out the dead request in "Preparing Static View…" — never failed.
    await waitFor(() => expect(screen.getByText("Preparing Static View…")).toBeInTheDocument());
    expect(screen.queryByText("Static View failed to start")).toBeNull();

    await waitFor(() => expect(screen.getByText("Static View ready")).toBeInTheDocument(), { timeout: 15_000 });
    expect(screen.getByTestId("preview-iframe")).toBeInTheDocument();
  }, 20_000);

  it("an unshaped 502 from the start POST keeps the panel polling instead of failing", async () => {
    let posted = false;
    mockFetch((url, init) => {
      if (url.includes("/index.html")) return new Response("<h1>Fresh Bread</h1>", { status: 200 });
      if (!isPreviewApi(url)) return undefined;
      if (isPost(init)) {
        posted = true;
        // A Railway-edge style 502: non-JSON body, no runtime fields.
        return new Response("<html>bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } });
      }
      return json(posted ? readyFor("project-a") : NOT_STARTED);
    });
    render(panel("project-a"));

    await waitFor(() => expect(screen.getByText("Static View ready")).toBeInTheDocument(), { timeout: 15_000 });
    expect(screen.queryByText("Static View failed to start")).toBeNull();
    expect(screen.queryByText(/Preview preparation failed/)).toBeNull();
  }, 20_000);

  it("a failed runtime behind a dead start request still surfaces its real error via polling", async () => {
    let posted = false;
    mockFetch((url, init) => {
      if (!isPreviewApi(url)) return undefined;
      if (isPost(init)) {
        posted = true;
        return Promise.reject(new TypeError("network error"));
      }
      return json(
        posted
          ? { runtimeStatus: "failed", previewUrl: null, runtimeError: "Dependency install failed in sandbox (exit 1)", runtimeErrorCode: "preview_dependency_install_failed" }
          : NOT_STARTED,
      );
    });
    render(panel("project-a"));

    await waitFor(
      () => expect(screen.getByText("Dependency install failed in sandbox (exit 1)")).toBeInTheDocument(),
      { timeout: 15_000 },
    );
    expect(screen.getByText("Static View failed to start")).toBeInTheDocument();
  }, 20_000);
});
