// @vitest-environment jsdom
/**
 * StudioPreviewPanel — starter-template honesty + static selection truth.
 *
 * Wave-3 Findings 4/5 (Larry's screenshot, 2026-11-10): a project whose
 * only build FAILED still had its seeded starter scaffold rendered as
 * the project's site under a green "Preview ready", plus an amber
 * "Element selection is unavailable" strip. Two code truths drive these
 * tests:
 *   - /workspace-state already reports `starterContent` (entry page is
 *     still the seeded welcome scaffold); the panel never consumed it.
 *   - Static previews are served under an opaque-origin sandbox (the
 *     security boundary for user content) with NO injected inspector, so
 *     the selection bridge handshake can never answer for them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";
import { useExecutionStore } from "../stores/useExecutionStore";

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

type WorkspaceStatePayload = { scaffolded?: boolean; touched?: boolean; starterContent?: boolean };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(workspaceState: WorkspaceStatePayload, previewPayload: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return jsonResponse(workspaceState);
    return jsonResponse(previewPayload);
  });
}

const STATIC_READY = { runtimeStatus: "ready", previewUrl: "https://terminal.example.com/preview/ws-1?token=<redacted>", runtimeError: null, framework: "static" };

function renderPanel(extraProps: Record<string, unknown> = {}) {
  return render(
    <StudioPreviewPanel
      projectId="project-1"
      projectName="Demo"
      repositoryName={null}
      branch="main"
      workspaceStatus="ready"
      {...extraProps}
    />,
  );
}

describe("StudioPreviewPanel starter-template honesty", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("labels an untouched starter scaffold as a template, never 'Preview ready'", async () => {
    mockFetch({ scaffolded: true, touched: false, starterContent: true }, STATIC_READY);
    renderPanel();

    expect(await screen.findByTitle("Demo preview")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText("Starter template — not built yet").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Preview ready")).toBeNull();
    const notice = await screen.findByTestId("preview-starter-notice");
    expect(notice.textContent).toMatch(/nothing has been built/i);
  });

  it("says the last build failed, and why, when a failure note is provided", async () => {
    mockFetch({ scaffolded: true, touched: false, starterContent: true }, STATIC_READY);
    renderPanel({ lastRunFailureNote: "All currently available AI routes were unavailable or reached their limits." });

    const notice = await screen.findByTestId("preview-starter-notice");
    await waitFor(() => {
      expect(notice.textContent).toMatch(/last build failed/i);
    });
    expect(notice.textContent).toContain("AI routes were unavailable");
    expect(screen.queryByText("Preview ready")).toBeNull();
  });

  it("still labels the entry page as starter after edits that never replaced it", async () => {
    mockFetch({ scaffolded: false, touched: true, starterContent: true }, STATIC_READY);
    renderPanel();

    const notice = await screen.findByTestId("preview-starter-notice");
    expect(notice.textContent).toMatch(/starter template/i);
    expect(screen.queryByText("Preview ready")).toBeNull();
  });

  it("a real built static site keeps the honest 'Preview ready' and no starter notice", async () => {
    mockFetch({ scaffolded: false, touched: true, starterContent: false }, STATIC_READY);
    renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText("Preview ready").length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("preview-starter-notice")).toBeNull();
  });

  it("static previews report selection as unavailable immediately — no doomed bridge handshake", async () => {
    mockFetch({ scaffolded: false, touched: true, starterContent: false }, STATIC_READY);
    renderPanel();

    const iframe = (await screen.findByTitle("Demo preview")) as HTMLIFrameElement;
    // Simulate the opaque-origin sandbox: contentDocument is inaccessible.
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        throw new DOMException("Blocked a frame with origin", "SecurityError");
      },
    });
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    fireEvent.load(iframe);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/isn't available for static previews/i)).toBeInTheDocument();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
