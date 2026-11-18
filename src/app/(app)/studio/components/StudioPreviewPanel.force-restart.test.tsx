import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";

// Round 13 (2026-11-17): the panel's Restart in the FAILED state must
// take the terminal's force-restart path, not re-POST a plain start —
// a plain start can silently adopt a wedged in-flight runtime (the
// start path's reuse gate), which is exactly what the 2026-11-17
// proof hit: attempt 2's "Restart" adopted attempt 1's runtime
// verbatim and waited on its probe. The panel now sends
// { restart: true } on the start POST from the failed state (both
// the pane CTA and the toolbar Restart); the web route maps that to
// restartPreviewInternal. The initial Start stays a plain start.

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TOUCHED_NO_CODE = { scaffolded: false, touched: true, starterContent: false };

interface CapturedPost {
  url: string;
  body: unknown;
}

function mockFetch(opts: {
  previewGet: unknown;
  previewPost?: unknown;
  posts: CapturedPost[];
}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return jsonResponse(TOUCHED_NO_CODE);
    if (url.includes("/preview")) {
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "POST") {
        const raw = (init as RequestInit | undefined)?.body;
        opts.posts.push({
          url,
          body: typeof raw === "string" ? JSON.parse(raw) : raw ?? null,
        });
        return opts.previewPost
          ? jsonResponse(opts.previewPost)
          : jsonResponse({ error: "no post handler" }, 500);
      }
      return jsonResponse(opts.previewGet);
    }
    if (url.startsWith("https://proxy.test")) {
      return new Response("<html>ok</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
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
      workspaceStatus={null}
      sourceKind="github"
    />,
  );
}

const FAILED_GET = {
  runtimeStatus: "failed",
  previewUrl: null,
  runtimeError: "Health check failed — the sandbox dev server may have crashed",
  runtimeErrorCode: "preview_dev_server_failed",
};

const STARTING_POST = {
  runtimeStatus: "starting",
  previewUrl: null,
  runtimeError: null,
  runtimeErrorCode: null,
};

describe("StudioPreviewPanel — failed-state Restart takes the force path (round 13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("the pane CTA 'Restart preview' POSTs { restart: true }", async () => {
    const posts: CapturedPost[] = [];
    mockFetch({ previewGet: FAILED_GET, previewPost: STARTING_POST, posts });
    renderPanel();

    const cta = await screen.findByTestId("preview-prepare");
    expect(cta).toHaveTextContent("Restart preview");

    fireEvent.click(cta);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ restart: true });
  }, 20000);

  it("the toolbar Restart in the failed state also POSTs { restart: true }", async () => {
    const posts: CapturedPost[] = [];
    mockFetch({ previewGet: FAILED_GET, previewPost: STARTING_POST, posts });
    renderPanel();

    const toolbarRestart = await screen.findByTestId("preview-restart");
    fireEvent.click(toolbarRestart);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ restart: true });
  }, 20000);

  it("the initial Start from not_started stays a plain start (no restart flag)", async () => {
    const posts: CapturedPost[] = [];
    mockFetch({
      previewGet: {
        runtimeStatus: "not_started",
        previewUrl: null,
        runtimeError: null,
        runtimeErrorCode: null,
      },
      previewPost: STARTING_POST,
      posts,
    });
    renderPanel();

    // Auto-start (or the Start CTA) fires exactly one plain start.
    await waitFor(() => expect(posts).toHaveLength(1), { timeout: 10000 });
    expect(posts[0].body).toEqual({});
  }, 20000);
});
