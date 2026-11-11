import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";
import {
  HOST_EXECUTION_UNAVAILABLE_LABEL,
  HOST_EXECUTION_UNAVAILABLE_MESSAGE,
} from "@/lib/projects/runtime-state";

// Seam close (companion to the route fixes): the workspace-state lookup runs
// on every Studio mount, and for a repo-backed project whose prepare was
// refused it is the ONLY response that reliably carries the refusal — the
// preview payload on Larry's production path arrives code-less, so the
// wave-4/#887 threading (keyed on the preview payload's runtimeErrorCode)
// never engages. The workspace-state route now returns the fallback body
// plus the recovered workspaceErrorCode; the panel must consume it: honest
// notice, no Start/Restart affordance, and no doomed auto-start POST.

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const NOT_STARTED_NO_CODE = {
  runtimeStatus: "not_started",
  previewUrl: null,
  runtimeError: null,
  runtimeErrorCode: null,
};

const REFUSAL_WORKSPACE_STATE = {
  scaffolded: false,
  touched: false,
  starterContent: false,
  code: "WORKSPACE_NOT_PROVISIONED",
  workspaceErrorCode: "HOST_EXECUTION_DISABLED",
};

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

describe("StudioPreviewPanel — host-exec truth via the workspace-state path", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("engages the honest notice from the workspace-state refusal — and never fires a doomed start", async () => {
    const previewPosts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/workspace-state")) return jsonResponse(REFUSAL_WORKSPACE_STATE);
      if (url.includes("/preview")) {
        const method = (init as RequestInit | undefined)?.method ?? "GET";
        if (method === "POST") previewPosts.push(url);
        return jsonResponse(NOT_STARTED_NO_CODE);
      }
      return new Response("not found", { status: 404 });
    });
    renderPanel();

    const notice = await screen.findByTestId("preview-host-exec-notice");
    expect(notice).toHaveTextContent(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(screen.getByText(HOST_EXECUTION_UNAVAILABLE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText("Preview failed to start")).toBeNull();
    expect(screen.queryByText("Preview not started")).toBeNull();
    expect(screen.queryByText("Workspace preparation failed")).toBeNull();

    // No futile affordances on either surface…
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByTestId("preview-restart")).toBeNull();
    expect(screen.queryByRole("button", { name: /restart preview/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /start preview/i })).toBeNull();
    // …and the known-refused workspace is never auto-started.
    expect(previewPosts).toEqual([]);

    expect(screen.getByTestId("preview-source-summary")).not.toHaveTextContent("Source error");
  });

  it("stays generic when the workspace-state body carries no host-exec code", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/workspace-state")) {
        return jsonResponse({ scaffolded: false, touched: true, starterContent: false });
      }
      if (url.includes("/preview")) {
        const method = (init as RequestInit | undefined)?.method ?? "GET";
        if (method === "POST") {
          return jsonResponse(
            {
              error: "Workspace preparation failed",
              runtimeStatus: "failed",
              runtimeError: "Workspace preparation failed",
              runtimeErrorCode: null,
            },
            500,
          );
        }
        return jsonResponse(NOT_STARTED_NO_CODE);
      }
      return new Response("not found", { status: 404 });
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Preview failed to start")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("preview-host-exec-notice")).toBeNull();
    expect(screen.getByTestId("preview-prepare")).toHaveTextContent("Restart preview");
    expect(screen.getByTestId("preview-restart")).toBeInTheDocument();
  });
});
