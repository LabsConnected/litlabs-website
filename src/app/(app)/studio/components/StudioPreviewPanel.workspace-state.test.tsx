import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";
import {
  HOST_EXECUTION_UNAVAILABLE_LABEL,
  HOST_EXECUTION_UNAVAILABLE_MESSAGE,
} from "@/lib/projects/runtime-state";

// Host-exec truth via the workspace-state channel (ART-20261111-024).
//
// The preview payload is not a reliable carrier for the refusal code: the
// preview GET only threads the code when the stored workspace status is
// failed/error AND the stored workspaceError still embeds it, and the
// panel's own timeout paths null the code when they force "failed". On
// Larry's production path (repo-backed project, hosted service) the pane
// settled code-less as a generic "Preview failed to start" — with a
// Restart preview button (twice) that can never succeed. The
// workspace-state lookup runs on every mount and its route now names the
// refusal directly (workspaceErrorCode, recovered from the stored
// workspaceError). The panel must consume that channel: honest notice,
// no Start/Restart affordance, and no doomed auto-start POST.

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

function renderPanel(workspaceStatus: string | null) {
  return render(
    <StudioPreviewPanel
      projectId="project-1"
      projectName="LabsConnected/litlabs-website"
      repositoryName="LabsConnected/litlabs-website"
      branch="main"
      workspaceStatus={workspaceStatus}
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

  it("production settle: code-less failed pane + workspace-state refusal → notice, no Restart", async () => {
    const previewPosts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/workspace-state")) return jsonResponse(REFUSAL_WORKSPACE_STATE);
      if (url.includes("/preview")) {
        const method = (init as RequestInit | undefined)?.method ?? "GET";
        if (method === "POST") previewPosts.push(url);
        // The production shape: the workspace-status prop maps this to a
        // failed state, but the payload itself carries no code.
        return jsonResponse({
          runtimeStatus: "not_started",
          previewUrl: null,
          runtimeError: "Workspace preparation failed",
          runtimeErrorCode: null,
        });
      }
      return new Response("not found", { status: 404 });
    });
    renderPanel("failed");

    const notice = await screen.findByTestId("preview-host-exec-notice");
    expect(notice).toHaveTextContent(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(screen.getByText(HOST_EXECUTION_UNAVAILABLE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText("Preview failed to start")).toBeNull();

    // No futile affordances on either surface, and no start was attempted.
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByTestId("preview-restart")).toBeNull();
    expect(screen.queryByRole("button", { name: /restart preview/i })).toBeNull();
    expect(previewPosts).toEqual([]);

    // The source line stops claiming a generic "Source error".
    expect(screen.getByTestId("preview-source-summary")).not.toHaveTextContent("Source error");
  });

  it("not_started settle: refusal known → notice in place, no Start, no doomed auto-start POST", async () => {
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
    renderPanel(null);

    const notice = await screen.findByTestId("preview-host-exec-notice");
    expect(notice).toHaveTextContent(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(screen.getByText(HOST_EXECUTION_UNAVAILABLE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText("Preview not started")).toBeNull();

    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByRole("button", { name: /start preview/i })).toBeNull();
    expect(previewPosts).toEqual([]);
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
    renderPanel("failed");

    await waitFor(() => {
      expect(screen.getByText("Preview failed to start")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("preview-host-exec-notice")).toBeNull();
    expect(screen.getByTestId("preview-prepare")).toHaveTextContent("Restart preview");
    expect(screen.getByTestId("preview-restart")).toBeInTheDocument();
  });
});
