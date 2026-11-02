import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";

// Regression coverage for the "Preview not started — Preparing your preview
// automatically…" dead end: bounded start, visible failure, working Retry,
// project-switch isolation, ID-based identity and truthful "ready".

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

// Stable identity on purpose: a new getToken every render would re-create the status loader and re-arm auto-start.
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

const HAS_CONTENT = { scaffolded: false, touched: true, starterContent: false };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Routes workspace-state to `workspaceState`, then to `handler`; unhandled calls get 404. */
function mockFetch(handler: Handler, workspaceState: Response | Promise<Response> = json(HAS_CONTENT)) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return workspaceState instanceof Response ? workspaceState.clone() : workspaceState;
    return (await handler(url, init)) ?? new Response("not found", { status: 404 });
  });
}

function panel(projectId: string | null, extra: { name?: string; refreshKey?: number; startGraceMs?: number } = {}) {
  return (
    <StudioPreviewPanel
      projectId={projectId}
      projectName={extra.name ?? "My new project"}
      repositoryName={null}
      branch={null}
      workspaceStatus="ready"
      refreshKey={extra.refreshKey ?? 0}
      startGraceMs={extra.startGraceMs}
    />
  );
}

const NOT_STARTED = { runtimeStatus: "not_started", previewUrl: null, runtimeError: null };
const STATIC_NOT_STARTED = { ...NOT_STARTED, framework: "static" };
const readyFor = (id: string) => ({ runtimeStatus: "ready", previewUrl: `/api/preview/${id}/index.html`, runtimeError: null });
const isPost = (init?: RequestInit) => init?.method === "POST";
const isPreviewApi = (url: string) => /\/api\/studio-projects\/[^/]+\/preview$/.test(url);
const countPosts = (spy: ReturnType<typeof mockFetch>) => spy.mock.calls.filter(([, init]) => isPost(init as RequestInit)).length;

describe("StudioPreviewPanel recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("a start that answers 'not started' becomes a visible failure with Retry, never endless 'Preparing…'", async () => {
    mockFetch((url) => (isPreviewApi(url) ? json(NOT_STARTED) : undefined));
    render(panel("project-a"));

    await waitFor(() => expect(screen.getByText("Preview failed to start")).toBeInTheDocument());
    expect(screen.queryByText("Preparing your preview automatically…")).toBeNull();
    expect(screen.getByTestId("preview-prepare")).toBeEnabled();
  });

  it("a failed auto-start shows the real error and Retry recovers to a verified, ready preview", async () => {
    let attempt = 0;
    const spy = mockFetch((url, init) => {
      if (url.includes("/index.html")) return new Response("<h1>Fresh Bread</h1>", { status: 200 });
      if (!isPreviewApi(url)) return undefined;
      if (isPost(init)) {
        attempt += 1;
        return attempt === 1 ? json({ runtimeError: "terminal server refused" }, 500) : json(readyFor("project-a"));
      }
      return json(NOT_STARTED);
    });
    render(panel("project-a"));

    await waitFor(() => expect(screen.getByText("terminal server refused")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("preview-prepare"));

    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
    expect(screen.getByTitle("My new project preview")).toBeInTheDocument();
    expect(countPosts(spy)).toBe(2);
  });

  it("an unresolved start is bounded: after the grace period it fails with Retry", async () => {
    // workspace truth never resolves, so auto-start never fires and the panel sits in not_started.
    mockFetch((url) => (isPreviewApi(url) ? json(NOT_STARTED) : undefined), new Promise<Response>(() => undefined));
    render(panel("project-a", { startGraceMs: 300 }));

    await waitFor(() => expect(screen.getByText("Preview not started")).toBeInTheDocument());

    await waitFor(() => expect(screen.getByText("The preview did not start in time. Retry to start it again.")).toBeInTheDocument());
    expect(screen.getByText("Preview failed to start")).toBeInTheDocument();
    expect(screen.getByTestId("preview-prepare")).toBeEnabled();
  });

  it("offers a manual start when the workspace looks untouched but the user has files", async () => {
    const spy = mockFetch(
      (url, init) => (isPreviewApi(url) ? (isPost(init) ? json(readyFor("project-a")) : json(NOT_STARTED)) : url.includes("/index.html") ? new Response("ok") : undefined),
      json({ scaffolded: true, touched: false }),
    );
    render(panel("project-a"));

    await waitFor(() => expect(screen.getByText("No preview yet")).toBeInTheDocument());
    expect(countPosts(spy)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /start preview/i }));

    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
    expect(countPosts(spy)).toBe(1); // the manual click is what started it
  });

  it("new content (refreshKey) re-arms a spent auto-start and recovers", async () => {
    let posts = 0;
    const spy = mockFetch((url, init) => {
      if (url.includes("/index.html")) return new Response("ok");
      if (!isPreviewApi(url)) return undefined;
      if (isPost(init)) {
        posts += 1;
        return posts === 1 ? json({ runtimeError: "boom" }, 500) : json(readyFor("project-a"));
      }
      return json(NOT_STARTED);
    });
    const view = render(panel("project-a"));
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());

    view.rerender(panel("project-a", { refreshKey: 1 }));

    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
    expect(countPosts(spy)).toBe(2);
  });

  it("never says 'Preview ready' when the preview address returns 404, and Retry re-checks it", async () => {
    let served = false;
    mockFetch((url) => {
      if (url.includes("/index.html")) return served ? new Response("<h1>hi</h1>") : new Response("missing", { status: 404 });
      return isPreviewApi(url) ? json(readyFor("project-a")) : undefined;
    });
    render(panel("project-a"));

    await waitFor(() => expect(screen.getAllByText("Preview failed to load").length).toBeGreaterThan(0));
    expect(screen.getByText(/returned 404/)).toBeInTheDocument();
    expect(screen.queryByText("Preview ready")).toBeNull();
    expect(screen.queryByTestId("preview-iframe")).toBeNull();

    served = true;
    fireEvent.click(screen.getByTestId("preview-prepare"));
    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
    expect(screen.getByTestId("preview-iframe")).toBeInTheDocument();
  });

  it("project switch resets state: no stale iframe from the previous project and ID-keyed requests", async () => {
    const spy = mockFetch((url, init) => {
      if (url.includes("/index.html")) return new Response("ok");
      if (url.includes("/project-b/preview")) return isPost(init) ? json({ runtimeError: "b failed" }, 500) : json(NOT_STARTED);
      return isPreviewApi(url) ? json(readyFor("project-a")) : undefined;
    });
    const view = render(panel("project-a"));
    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
    expect(screen.getByTestId("preview-iframe").getAttribute("src")).toContain("/api/preview/project-a/");

    view.rerender(panel("project-b"));

    await waitFor(() => expect(screen.getByText("b failed")).toBeInTheDocument());
    expect(screen.queryByTestId("preview-iframe")).toBeNull();
    expect(screen.getByTestId("studio-preview-panel")).toHaveAttribute("data-project-id", "project-b");
    expect(spy.mock.calls.some(([url]) => String(url).includes("/project-b/preview"))).toBe(true);
  });

  it("a slow start for the previous project cannot overwrite the project now on screen", async () => {
    let releaseA!: (response: Response) => void;
    const slowA = new Promise<Response>((resolve) => { releaseA = resolve; });
    mockFetch((url, init) => {
      if (url.includes("/index.html")) return new Response("ok");
      if (url.includes("/project-a/preview")) return isPost(init) ? slowA : json(NOT_STARTED);
      return isPreviewApi(url) ? json(readyFor("project-b")) : undefined;
    });
    const view = render(panel("project-a"));
    await waitFor(() => expect(screen.getByText("Preparing preview…")).toBeInTheDocument());

    view.rerender(panel("project-b"));
    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());

    await act(async () => { releaseA(json({ runtimeError: "late failure for A" }, 500)); });

    expect(screen.getByText("Preview ready")).toBeInTheDocument();
    expect(screen.queryByText("late failure for A")).toBeNull();
  });

  it("two projects with the same display name are addressed by ID only", async () => {
    const spy = mockFetch((url) => (url.includes("/index.html") ? new Response("ok") : isPreviewApi(url) ? json(readyFor("e7db6424")) : undefined));
    render(panel("e7db6424", { name: "My new project" }));

    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
    const urls = spy.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/api/studio-projects/e7db6424/preview"))).toBe(true);
    expect(urls.some((url) => /My%20new%20project|My new project/.test(url))).toBe(false);
    expect(screen.getByText("My new project")).toHaveAttribute("title", "My new project · e7db6424");
  });

  it("preview state depends only on the preview API, never on terminal/PTY endpoints", async () => {
    const spy = mockFetch((url) => (url.includes("/index.html") ? new Response("ok") : isPreviewApi(url) ? json(readyFor("project-a")) : undefined));
    render(panel("project-a"));

    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
    expect(spy.mock.calls.some(([url]) => /terminal/i.test(String(url)))).toBe(false);
    expect(screen.queryByText(/terminal error/i)).toBeNull();
  });

  it("a slow status request is not re-issued every 3s, so its response is applied", async () => {
    let release!: (response: Response) => void;
    const slow = new Promise<Response>((resolve) => { release = resolve; });
    const spy = mockFetch((url) => {
      if (url.includes("/api/preview/project-a/index.html")) return new Response("<h1>ok</h1>");
      return isPreviewApi(url) ? slow : undefined;
    });
    render(panel("project-a"));
    await waitFor(() => expect(screen.getAllByText("Checking preview status…").length).toBeGreaterThan(0));

    await new Promise((resolve) => setTimeout(resolve, 3500)); // longer than one poll interval
    const statusGets = spy.mock.calls.filter(([url, init]) => isPreviewApi(String(url)) && !isPost(init as RequestInit)).length;
    expect(statusGets).toBe(1);

    await act(async () => { release(json({ ...STATIC_NOT_STARTED, runtimeStatus: "ready", previewUrl: "/api/preview/project-a/index.html" })); });
    await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
  });
  describe("static projects (server rejects POST /preview by design)", () => {
    it("start verifies index.html is served and never POSTs", async () => {
      const spy = mockFetch((url) => {
        if (url.includes("/api/preview/project-a/index.html")) return new Response("<h1>Fresh Bread</h1>");
        return isPreviewApi(url) ? json(STATIC_NOT_STARTED) : undefined;
      });
      render(panel("project-a"));

      await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
      expect(countPosts(spy)).toBe(0);
      expect(screen.getByTestId("preview-iframe").getAttribute("src")).toContain("/api/preview/project-a/index.html");
    });

    it("an unserved index.html fails with the HTTP status, and Retry recovers once it is served", async () => {
      let served = false;
      const spy = mockFetch((url) => {
        if (url.includes("/api/preview/project-a/index.html")) return served ? new Response("<h1>ok</h1>") : new Response("missing", { status: 404 });
        return isPreviewApi(url) ? json(STATIC_NOT_STARTED) : undefined;
      });
      render(panel("project-a"));

      await waitFor(() => expect(screen.getByText("index.html is not being served for this project (HTTP 404).")).toBeInTheDocument());
      expect(screen.queryByText("Preview ready")).toBeNull();

      served = true;
      fireEvent.click(screen.getByTestId("preview-prepare"));
      await waitFor(() => expect(screen.getByText("Preview ready")).toBeInTheDocument());
      expect(countPosts(spy)).toBe(0);
    });
  });
});