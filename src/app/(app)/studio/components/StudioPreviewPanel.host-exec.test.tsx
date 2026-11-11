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

// Prepare-path regression (Larry's production screenshot, 2026-11-10 ~21:31
// EST, production on f228f11a): the wave-4 tests above mock the prepare POST
// as HTTP 200 with the same payload as the GET. Production's POST answers
// 500 — and on that path the panel threw payload.runtimeError into its catch
// block, which set errorCode to null unconditionally. The code the server
// DID send in the 500 body was destroyed, so the pane rendered the raw
// serialized error under "Preview failed to start" and re-offered the
// futile "Restart preview". These tests drive the real shapes: GET reports
// not_started (auto-start fires), POST answers 500.
const RAW_HOST_EXEC_ERROR =
  'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}';

function mockFetchByMethod(
  getPayload: Record<string, unknown>,
  postPayload: Record<string, unknown>,
  postStatus = 200,
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return jsonResponse(HAS_CONTENT);
    if (url.includes("/preview")) {
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "POST") return jsonResponse(postPayload, postStatus);
      return jsonResponse(getPayload);
    }
    return new Response("not found", { status: 404 });
  });
}

const NOT_STARTED_NO_CODE = {
  runtimeStatus: "not_started",
  previewUrl: null,
  runtimeError: null,
  runtimeErrorCode: null,
};

describe("StudioPreviewPanel — host-execution truth on the prepare path (POST 500)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("survives the auto-start POST 500: honest copy, no raw JSON, no Restart", async () => {
    mockFetchByMethod(
      NOT_STARTED_NO_CODE,
      {
        error: RAW_HOST_EXEC_ERROR,
        runtimeStatus: "failed",
        runtimeError: RAW_HOST_EXEC_ERROR,
        runtimeErrorCode: "HOST_EXECUTION_DISABLED",
      },
      500,
    );
    renderPanel();

    const notice = await screen.findByTestId("preview-host-exec-notice");
    expect(notice).toHaveTextContent(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(screen.getByText(HOST_EXECUTION_UNAVAILABLE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText("Preview failed to start")).toBeNull();
    // The raw serialized server error must never render verbatim.
    expect(document.body.textContent).not.toContain("Workspace prepare failed (503)");
    expect(document.body.textContent).not.toContain('"code"');
    // No futile affordances on either surface.
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByTestId("preview-restart")).toBeNull();
    expect(screen.queryByRole("button", { name: /restart preview/i })).toBeNull();
  });

  it("recovers the code from the message when the 500 body omits runtimeErrorCode", async () => {
    mockFetchByMethod(
      NOT_STARTED_NO_CODE,
      {
        error: RAW_HOST_EXEC_ERROR,
        runtimeStatus: "failed",
        runtimeError: RAW_HOST_EXEC_ERROR,
      },
      500,
    );
    renderPanel();

    const notice = await screen.findByTestId("preview-host-exec-notice");
    expect(notice).toHaveTextContent(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(screen.queryByText("Preview failed to start")).toBeNull();
    expect(document.body.textContent).not.toContain("Workspace prepare failed (503)");
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByTestId("preview-restart")).toBeNull();
  });

  it("keeps the generic POST-500 failure byte-for-byte, Restart included", async () => {
    mockFetchByMethod(
      NOT_STARTED_NO_CODE,
      {
        error: "Workspace preparation failed",
        runtimeStatus: "failed",
        runtimeError: "Workspace preparation failed",
        runtimeErrorCode: null,
      },
      500,
    );
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Preview failed to start")).toBeInTheDocument();
    });
    expect(screen.getByText("Workspace preparation failed")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-host-exec-notice")).toBeNull();
    const action = screen.getByTestId("preview-prepare");
    expect(action).toHaveTextContent("Restart preview");
    expect(screen.getByTestId("preview-restart")).toBeInTheDocument();
  });

  it("never renders a serialized server error verbatim for non-host-exec failures either", async () => {
    const rawOther =
      'Workspace prepare failed (503): {"error":"Kaboom inside the sandbox","code":"SANDBOX_KABOOM"}';
    mockFetch({
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: rawOther,
      runtimeErrorCode: "SANDBOX_KABOOM",
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Preview failed to start")).toBeInTheDocument();
    });
    // Raw machine payload is mapped to the human fallback sentence…
    expect(screen.getByText("The dev server failed to start. Try restarting it.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Kaboom inside the sandbox");
    expect(document.body.textContent).not.toContain("Workspace prepare failed (503)");
    expect(document.body.textContent).not.toContain('"code"');
    // …and the failure stays a generic one: Restart remains available.
    expect(screen.queryByTestId("preview-host-exec-notice")).toBeNull();
    expect(screen.getByTestId("preview-prepare")).toHaveTextContent("Restart preview");
    expect(screen.getByTestId("preview-restart")).toBeInTheDocument();
  });
});
