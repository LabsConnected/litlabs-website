import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";

// Restart gating when the host-execution refusal is KNOWN (follow-up to
// ART-20261111-024 / PR #901).
//
// #901 suppressed the futile Restart only while the panel state was
// "failed" or "not_started" (hostExecBlocked). Production on f9ad12cd
// still rendered "Restart preview" twice on the repo-backed project:
// the refusal can be known while the panel settles in another state
// (e.g. "unreachable", whose pane CTA — handleRetry → preparePreview —
// fires the same doomed prepare POST), and #901's auto-start guard read
// only the workspace-state channel, not the preview payload's own code.
// These tests pin: once the refusal is known on EITHER channel, no
// restart/prepare affordance renders in ANY state and no prepare POST
// fires — while a genuinely restartable managed failure keeps a working
// Restart.

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TOUCHED_NO_CODE = { scaffolded: false, touched: true, starterContent: false };

const REFUSAL_WORKSPACE_STATE = {
  scaffolded: false,
  touched: false,
  starterContent: false,
  code: "WORKSPACE_NOT_PROVISIONED",
  workspaceErrorCode: "HOST_EXECUTION_DISABLED",
};

function mockFetch(opts: {
  workspaceState: unknown;
  previewGet: unknown;
  previewPost?: unknown;
  posts?: string[];
}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return jsonResponse(opts.workspaceState);
    if (url.includes("/preview")) {
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "POST") {
        opts.posts?.push(url);
        return opts.previewPost
          ? jsonResponse(opts.previewPost)
          : jsonResponse({ error: "no post handler" }, 500);
      }
      return jsonResponse(opts.previewGet);
    }
    // The panel probes the preview URL itself before trusting "ready" —
    // the fake proxy host answers OK so the frame check passes.
    if (url.startsWith("https://proxy.test")) {
      return new Response("<html>ok</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  });
}

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

describe("StudioPreviewPanel — restart gating once the refusal is known", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("refusal via preview payload + unreachable settle → no Restart, no prepare CTA", async () => {
    mockFetch({
      workspaceState: TOUCHED_NO_CODE,
      previewGet: {
        runtimeStatus: "unreachable",
        previewUrl: null,
        runtimeError: "Preview runtime unreachable",
        runtimeErrorCode: "HOST_EXECUTION_DISABLED",
      },
    });
    renderPanel(null);

    // The panel settles unreachable — the state #901's state-scoped gate
    // did not cover, where the pane CTA still offered a prepare attempt.
    await screen.findAllByText("Preview runtime unreachable");
    expect(screen.queryByTestId("preview-restart")).toBeNull();
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByRole("button", { name: /restart preview/i })).toBeNull();
  });

  it("refusal via workspace-state + unreachable settle → no Restart, no prepare CTA", async () => {
    mockFetch({
      workspaceState: REFUSAL_WORKSPACE_STATE,
      previewGet: {
        runtimeStatus: "unreachable",
        previewUrl: null,
        runtimeError: "Preview runtime unreachable",
        runtimeErrorCode: null,
      },
    });
    renderPanel(null);

    await screen.findAllByText("Preview runtime unreachable");
    expect(screen.queryByTestId("preview-restart")).toBeNull();
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByRole("button", { name: /restart preview/i })).toBeNull();
  });

  it("refusal via preview payload only (not_started) → auto-start never fires the doomed POST", async () => {
    const posts: string[] = [];
    mockFetch({
      workspaceState: TOUCHED_NO_CODE,
      previewGet: {
        runtimeStatus: "not_started",
        previewUrl: null,
        runtimeError: "Workspace preparation failed",
        runtimeErrorCode: "HOST_EXECUTION_DISABLED",
      },
      posts,
    });
    renderPanel("failed");

    // The honest notice renders (the not_started settle was already
    // covered by #901) — and no prepare POST was attempted to learn the
    // refusal a second time, even though the workspace-state channel
    // carried no code.
    await screen.findByTestId("preview-host-exec-notice");
    // Flush the async window in which an (unpatched) auto-start would
    // fire its preflight + POST, so the no-POST assertion is not a race.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.queryByTestId("preview-prepare")).toBeNull();
    expect(screen.queryByTestId("preview-restart")).toBeNull();
    expect(posts).toEqual([]);
  });

  it("managed project, stopped dev server (generic failed) → Restart present and functional", async () => {
    const posts: string[] = [];
    mockFetch({
      workspaceState: TOUCHED_NO_CODE,
      previewGet: {
        runtimeStatus: "failed",
        previewUrl: null,
        runtimeError: "dev server crashed",
        runtimeErrorCode: null,
      },
      previewPost: {
        runtimeStatus: "ready",
        previewUrl: "https://proxy.test/ws-1",
        runtimeError: null,
        runtimeErrorCode: null,
      },
      posts,
    });
    render(
      <StudioPreviewPanel
        projectId="project-2"
        projectName="Managed Site"
        repositoryName={null}
        branch="main"
        workspaceStatus={null}
      />,
    );

    const cta = await screen.findByTestId("preview-prepare");
    expect(cta).toHaveTextContent("Restart preview");
    expect(screen.getByTestId("preview-restart")).toBeInTheDocument();

    fireEvent.click(cta);
    await waitFor(() => {
      expect(screen.getByTestId("preview-iframe")).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(posts.length).toBe(1);
    // A live preview keeps its (working) Restart control.
    expect(screen.getByTestId("preview-restart")).toBeInTheDocument();
  }, 20000);
});
