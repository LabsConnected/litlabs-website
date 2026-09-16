import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => impl(input as RequestInfo, init));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("StudioPreviewPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset the execution store between tests so previewPreparing doesn't leak.
    act(() => useExecutionStore.getState().reset());
  });

  it("does not claim readiness before the preview API reports a URL", async () => {
    mockFetch(() => jsonResponse({ runtimeStatus: "not_started", previewUrl: null, runtimeError: null }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch="main" workspaceStatus="ready" />);

    // not_started auto-starts, but the POST also returns not_started here,
    // so we should NOT see a ready iframe.
    await waitFor(() => {
      expect(screen.queryByTitle("Demo preview")).toBeNull();
    });
  });

  it("renders a preview only after the endpoint reports ready", async () => {
    mockFetch(() => jsonResponse({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName="owner/repo" branch="main" workspaceStatus="ready" />);

    await waitFor(() => {
      expect(screen.getByTitle("Demo preview")).toBeTruthy();
      expect(screen.getByRole("button", { name: /open/i })).toBeTruthy();
    });
  });

  it("auto-starts preview when status is not_started (no manual button click required)", async () => {
    let postCalled = false;
    mockFetch((_input, init) => {
      if (init?.method === "POST") {
        postCalled = true;
        return jsonResponse({ runtimeStatus: "starting", previewUrl: null, runtimeError: null });
      }
      // GET — return not_started so auto-start triggers
      return jsonResponse({ runtimeStatus: "not_started", previewUrl: null, runtimeError: null });
    });

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="not_prepared" />);

    await waitFor(() => expect(postCalled).toBe(true), { timeout: 3000 });
  });

  it("does not auto-start when preview is already ready", async () => {
    let postCalled = false;
    mockFetch((_input, init) => {
      if (init?.method === "POST") {
        postCalled = true;
        return jsonResponse({ runtimeStatus: "ready", previewUrl: "/proxy", runtimeError: null });
      }
      return jsonResponse({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null });
    });

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName="owner/repo" branch="main" workspaceStatus="ready" />);

    await waitFor(() => {
      expect(screen.getByTitle("Demo preview")).toBeTruthy();
    });
    // Give auto-start a moment to (not) fire
    await new Promise((r) => setTimeout(r, 100));
    expect(postCalled).toBe(false);
  });

  it("preview start occurs only once (single-flight guard)", async () => {
    let postCount = 0;
    mockFetch((_input, init) => {
      if (init?.method === "POST") {
        postCount++;
        return jsonResponse({ runtimeStatus: "starting", previewUrl: null, runtimeError: null });
      }
      return jsonResponse({ runtimeStatus: "not_started", previewUrl: null, runtimeError: null });
    });

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="not_prepared" />);

    // Wait for auto-start
    await waitFor(() => expect(postCount).toBe(1), { timeout: 3000 });
    // Wait a bit more — no duplicate should fire
    await new Promise((r) => setTimeout(r, 200));
    expect(postCount).toBe(1);
  });

  it("starting → ready loads the preview iframe", async () => {
    let callCount = 0;
    mockFetch((_input, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ runtimeStatus: "starting", previewUrl: null, runtimeError: null });
      }
      // GET — return starting first, then ready
      callCount++;
      if (callCount <= 1) {
        return jsonResponse({ runtimeStatus: "not_started", previewUrl: null, runtimeError: null });
      }
      return jsonResponse({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null });
    });

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName="owner/repo" branch="main" workspaceStatus="ready" />);

    await waitFor(() => {
      expect(screen.getByTitle("Demo preview")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("reports unreachable runtime honestly (not generic 'Preview unavailable')", async () => {
    mockFetch(() => jsonResponse({ runtimeStatus: "unreachable", previewUrl: null, runtimeError: "Terminal server connection refused" }));

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="ready" />);

    await waitFor(() => {
      expect(screen.getByText("Preview runtime unreachable")).toBeTruthy();
    });
    // The truthful error reason must be visible
    await waitFor(() => {
      expect(screen.getByText(/Terminal server connection refused/)).toBeTruthy();
    });
  });

  it("failed startup exposes the actual reason", async () => {
    mockFetch((_input, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ runtimeStatus: "failed", runtimeError: "Port 3000 already in use" }, 500);
      }
      return jsonResponse({ runtimeStatus: "not_started", previewUrl: null, runtimeError: null });
    });

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="not_prepared" />);

    await waitFor(() => {
      expect(screen.getByText(/Port 3000 already in use/)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("shows a Stop button when preview is ready and calls DELETE on click", async () => {
    const fetchMock = mockFetch(async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        return jsonResponse({ runtimeStatus: "stopped" });
      }
      // GET — return ready state
      return jsonResponse({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null });
    });

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName="owner/repo" branch="main" workspaceStatus="ready" />);

    // Wait for ready state
    await waitFor(() => {
      expect(screen.getByTitle("Demo preview")).toBeTruthy();
    });

    // Stop button should be visible
    const stopBtn = screen.getByTestId("preview-stop");
    expect(stopBtn).toBeTruthy();

    // Click stop
    fireEvent.click(stopBtn);

    // Should have called DELETE
    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("does not show a Stop button when preview is not ready", async () => {
    mockFetch(() => jsonResponse({ runtimeStatus: "unreachable", previewUrl: null, runtimeError: null }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="ready" />);

    await screen.findByText("Preview runtime unreachable");
    expect(screen.queryByTestId("preview-stop")).toBeNull();
  });

  it("captures a preview element as context for the next request", async () => {
    mockFetch(async () => jsonResponse({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null }));
    const onSelectionChange = vi.fn();
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch="main" workspaceStatus="ready" onSelectionChange={onSelectionChange} />);

    const iframe = (await screen.findByTitle("Demo preview")) as HTMLIFrameElement;
    const frameDocument = document;
    Object.defineProperty(iframe, "contentDocument", { configurable: true, value: frameDocument });
    const nav = frameDocument.createElement("nav");
    nav.setAttribute("aria-label", "Navigation");
    frameDocument.body.appendChild(nav);

    fireEvent.load(iframe);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(nav);
    nav.remove();

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ label: "Navigation", tagName: "nav" }));
      expect(screen.getByTestId("preview-selection")).toHaveTextContent("Selected: Navigation");
    });
  });

  it("signals previewPreparing to the execution store during preparation", async () => {
    let resolvePost: (value: Response) => void = () => {};
    const postPromise = new Promise<Response>((r) => { resolvePost = r; });
    mockFetch((_input, init) => {
      if (init?.method === "POST") return postPromise;
      return jsonResponse({ runtimeStatus: "not_started", previewUrl: null, runtimeError: null });
    });

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="not_prepared" />);

    // While POST is in flight, the store should report previewPreparing=true
    await waitFor(() => expect(useExecutionStore.getState().previewPreparing).toBe(true), { timeout: 3000 });

    // Resolve the POST
    resolvePost(jsonResponse({ runtimeStatus: "starting", previewUrl: null, runtimeError: null }));

    // After POST completes, previewPreparing should be false
    await waitFor(() => expect(useExecutionStore.getState().previewPreparing).toBe(false), { timeout: 3000 });
  });

  it("surfaces auth config error truthfully (not generic 'Preview unavailable')", async () => {
    mockFetch(() => jsonResponse({
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: "Dev server booted but returned a 500 with an authentication configuration error. The Clerk secret key or publishable key is invalid, stale, or mismatched.",
      runtimeErrorCode: "preview_auth_config_error",
    }));

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="ready" />);

    // Must show "Authentication configuration error", NOT "Preview failed to start"
    await waitFor(() => {
      expect(screen.getByText("Authentication configuration error")).toBeTruthy();
    });
    // Must NOT show the generic label
    expect(screen.queryByText("Preview failed to start")).toBeNull();
    // Must show the truthful error reason
    await waitFor(() => {
      expect(screen.getByText(/Clerk secret key or publishable key is invalid/)).toBeTruthy();
    });
  });

  it("surfaces clerk config error truthfully (not generic 'Preview unavailable')", async () => {
    mockFetch(() => jsonResponse({
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: "CLERK_SECRET_KEY contains a publishable key (pk_*) instead of a secret key (sk_*).",
      runtimeErrorCode: "preview_clerk_config_error",
    }));

    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="ready" />);

    await waitFor(() => {
      expect(screen.getByText("Authentication configuration error")).toBeTruthy();
    });
    expect(screen.queryByText("Preview failed to start")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/publishable key/)).toBeTruthy();
    });
  });

  it("header toolbar scrolls horizontally so action buttons stay reachable on narrow phones", async () => {
    mockFetch(() => jsonResponse({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch="main" workspaceStatus="ready" />);

    const toolbar = await screen.findByTestId("preview-toolbar");
    // The row holds the runtime badge, device-mode buttons, refresh,
    // restart, stop, copy-URL and maximize — on a 390px phone these
    // overflow, so the toolbar must scroll instead of clipping them.
    expect(toolbar.className).toContain("overflow-x-auto");
    // The action buttons must not shrink away when the row overflows.
    for (const testid of ["preview-refresh", "preview-restart", "preview-stop", "preview-copy-url", "preview-maximize"]) {
      const btn = toolbar.querySelector(`[data-testid="${testid}"]`);
      expect(btn, testid).toBeTruthy();
      expect(btn!.className).toContain("shrink-0");
    }
  });
});
