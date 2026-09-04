import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import StudioPreviewPanel from "./StudioPreviewPanel";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
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
});
