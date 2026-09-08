import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

describe("StudioPreviewPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not claim readiness before the preview API reports a URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ runtimeStatus: "stopped", previewUrl: null, runtimeError: null }), { status: 200 }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch="main" workspaceStatus="ready" />);

    await screen.findByText("Preview unavailable");
    expect(screen.queryByTitle("Demo preview")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/studio-projects/project-1/preview"), expect.anything());
  });

  it("renders a preview only after the endpoint reports ready", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null }), { status: 200 }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName="owner/repo" branch="main" workspaceStatus="ready" />);

    await waitFor(() => {
      expect(screen.getByTitle("Demo preview")).toBeTruthy();
      expect(screen.getByRole("button", { name: /open/i })).toBeTruthy();
    });
  });

  it("shows the unavailable state when the project is not prepared", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ runtimeStatus: "stopped", previewUrl: null, runtimeError: null }), { status: 200 }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="not_prepared" />);

    await screen.findByText("Preview not started");
    fireEvent.click(screen.getByRole("button", { name: /prepare preview/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it("shows a Stop button when preview is ready and calls DELETE on click", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        return new Response(JSON.stringify({ runtimeStatus: "stopped" }), { status: 200 });
      }
      // GET — return ready state
      return new Response(JSON.stringify({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null }), { status: 200 });
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
      const deleteCalls = fetchMock.mock.calls.filter(([url, init]) => init?.method === "DELETE");
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("does not show a Stop button when preview is not ready", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ runtimeStatus: "stopped", previewUrl: null, runtimeError: null }), { status: 200 }));
    render(<StudioPreviewPanel projectId="project-1" projectName="Demo" repositoryName={null} branch={null} workspaceStatus="not_prepared" />);

    await screen.findByText("Preview not started");
    expect(screen.queryByTestId("preview-stop")).toBeNull();
  });

  it("captures a preview element as context for the next request", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ runtimeStatus: "ready", previewUrl: "/api/studio-projects/project-1/preview/proxy", runtimeError: null }), { status: 200 }));
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
});
