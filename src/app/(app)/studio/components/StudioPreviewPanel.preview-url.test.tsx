/**
 * Regression tests: the Studio preview iframe must render the COMPLETE
 * preview URL — terminal host + /preview/:workspaceId path + preview
 * token — exactly as the preview-status API returns it.
 *
 * Production defect (2026-09-21): the iframe rendered the terminal
 * server's raw "Cannot GET /" (the Express default 404 for the bare
 * origin root) while the badge said "Preview ready". The end-to-end trace
 * (API route -> buildPreviewProxyUrl -> StudioPreviewPanel -> iframe src)
 * passes the URL through verbatim, so these tests pin that contract:
 * whatever previewUrl the API returns must reach the iframe's src with
 * host, path, and token intact — never collapsed to a bare origin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

const TERMINAL_HOST = "https://terminal.example.com";
const WORKSPACE_ID = "ws-3648d2ea-b9c5004a";
const TOKEN = "6fbfec4fd43b2b77388eda37213a541d5694a97dca6a82bc4eacd88b8ab2991f";
const PREVIEW_URL = `${TERMINAL_HOST}/preview/${WORKSPACE_ID}?token=${TOKEN}`;

function renderReadyPreview(previewUrl: string | null = PREVIEW_URL) {
  mockFetch(() =>
    jsonResponse({ runtimeStatus: "ready", previewUrl, runtimeError: null }),
  );
  render(
    <StudioPreviewPanel
      projectId="project-1"
      projectName="Demo"
      repositoryName={null}
      branch="main"
      workspaceStatus="ready"
    />,
  );
}

describe("StudioPreviewPanel — iframe renders the complete preview URL", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it("sets the iframe src to the API's previewUrl with host, path, and token intact", async () => {
    renderReadyPreview();
    const iframe = await screen.findByTitle("Demo preview");
    const src = iframe.getAttribute("src") ?? "";
    expect(src.startsWith(`${TERMINAL_HOST}/preview/${WORKSPACE_ID}`)).toBe(true);
    expect(src).toContain(`token=${TOKEN}`);
  });

  it("never points the iframe at the bare terminal-server root", async () => {
    renderReadyPreview();
    const iframe = await screen.findByTitle("Demo preview");
    const src = iframe.getAttribute("src") ?? "";
    // The bare origin is what rendered "Cannot GET /" in production.
    expect(src).not.toBe(TERMINAL_HOST);
    expect(src).not.toBe(`${TERMINAL_HOST}/`);
    const parsed = new URL(src);
    expect(parsed.pathname.startsWith("/preview/")).toBe(true);
  });

  it("renders no iframe when the API returns no previewUrl", async () => {
    renderReadyPreview(null);
    // Give the status fetch a chance to resolve.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByTitle("Demo preview")).toBeNull();
  });
});
