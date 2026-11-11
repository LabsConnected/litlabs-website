import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";
import {
  HOST_EXECUTION_UNAVAILABLE_LABEL,
  HOST_EXECUTION_UNAVAILABLE_MESSAGE,
} from "@/lib/projects/runtime-state";

// Wave-4 truth-in-UI: when workspace preparation failed with
// HOST_EXECUTION_DISABLED (the terminal-server's fail-closed 503 — repo-backed
// workspaces cannot open on the hosted service until a verified sandbox
// exists), the preview pane must say so plainly and must NOT offer a Restart
// button that can never succeed. Generic failures keep the existing state.

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

const HAS_CONTENT = { scaffolded: false, touched: true, starterContent: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(previewPayload: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return jsonResponse(HAS_CONTENT);
    if (url.includes("/preview")) return jsonResponse(previewPayload);
    return new Response("not found", { status: 404 });
  });
}

function renderPanel() {
  return render(
    <StudioPreviewPanel
      projectId="project-1"
      projectName="LabsConnected/litlabs-website"
      repositoryName="LabsConnected/litlabs-website"
      branch="main"
      workspaceStatus="failed"
      sourceKind="github"
      sourceStatus="error"
    />,
  );
}

describe("StudioPreviewPanel — host-execution truth (wave-4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("names the real blocker and offers no restart that cannot succeed", async () => {
    mockFetch({
      runtimeStatus: "not_started",
      previewUrl: null,
      runtimeError: null,
      runtimeErrorCode: "HOST_EXECUTION_DISABLED",
    });
    renderPanel();

    const notice = await screen.findByTestId("preview-host-exec-notice");
    expect(notice).toHaveTextContent(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(screen.getByText(HOST_EXECUTION_UNAVAILABLE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText("Preview failed to start")).toBeNull();
    expect(screen.queryByText("Workspace preparation failed")).toBeNull();

    // No false affordances: neither the body action nor the toolbar icon.
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByTestId("preview-restart")).toBeNull();
    expect(screen.queryByRole("button", { name: /restart preview/i })).toBeNull();

    // The source line stops claiming a generic "Source error".
    expect(screen.getByTestId("preview-source-summary")).not.toHaveTextContent("Source error");
    // Note: the panel's designed auto-start fires one prepare POST on the
    // way through (statusFromPayload maps the payload's not_started first);
    // the POST response carries the same code, so the settled state above
    // is the honest one — and crucially it is SETTLED: no control remains
    // that would fire another doomed attempt.
  });

  it("keeps the generic failed state — with its working Restart — for other failures", async () => {
    mockFetch({
      runtimeStatus: "not_started",
      previewUrl: null,
      runtimeError: "Workspace preparation failed",
      runtimeErrorCode: null,
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Preview failed to start")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("preview-host-exec-notice")).toBeNull();
    const action = screen.getByTestId("preview-prepare");
    expect(action).toHaveTextContent("Restart preview");
    expect(screen.getByTestId("preview-restart")).toBeInTheDocument();
    expect(screen.getByTestId("preview-source-summary")).toHaveTextContent("Source error");
  });
});
