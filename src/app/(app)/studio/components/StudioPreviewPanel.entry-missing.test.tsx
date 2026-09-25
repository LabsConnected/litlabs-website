/**
 * Regression tests: the Studio preview badge must flip off "Preview ready"
 * the moment the proxy reports the entry route is missing — not 30s later
 * at the next status poll.
 *
 * Production defect (2026-09-18): the iframe showed the backend's white
 * "Cannot GET /" while every badge still said "Preview ready". The proxy
 * now serves an honest error page that postMessages
 * { source: "litt-preview", type: "preview-entry-missing" }; the panel
 * must re-check status immediately on that message.
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

const PREVIEW_URL = "https://preview.example.com/preview/ws_1?token=abc";
const PREVIEW_ORIGIN = "https://preview.example.com";

function renderReadyPreview() {
  const fetchSpy = mockFetch(() =>
    jsonResponse({ runtimeStatus: "ready", previewUrl: PREVIEW_URL, runtimeError: null }),
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
  return fetchSpy;
}

describe("StudioPreviewPanel — preview-entry-missing message", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => useExecutionStore.getState().reset());
  });

  it(
    "re-checks preview status immediately when the proxy reports the entry route missing",
    // 20s: the default 5s test timeout kills this test under CI load before
    // the waitFor below can finish (flaked 2026-09-22).
    { timeout: 20000 },
    async () => {
      const fetchSpy = renderReadyPreview();
      await screen.findByTitle("Demo preview");
      const callsAfterReady = fetchSpy.mock.calls.length;
      expect(callsAfterReady).toBeGreaterThan(0);

      // Let React commit the previewUrl-dependent message listener before
      // dispatching; findByTitle only proves the iframe node exists.
      await act(async () => Promise.resolve());
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: PREVIEW_ORIGIN,
            data: { source: "litt-preview", type: "preview-entry-missing", workspaceId: "ws_1" },
          }),
        );
      });

      // The badge must not wait for the 30s poll — a status re-check fires now.
      // Generous timeout: the handler awaits authHeaders() before fetch, and
      // this flakes under CI load with the default 1s timeout (2026-09-21).
      // 10s still proves "immediate" versus the 30s poll interval.
      await vi.waitFor(
        () => {
          expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterReady);
        },
        { timeout: 10000 },
      );
    },
  );

  it("ignores the message from a foreign origin", async () => {
    const fetchSpy = renderReadyPreview();
    await screen.findByTitle("Demo preview");
    const callsAfterReady = fetchSpy.mock.calls.length;

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example.com",
        data: { source: "litt-preview", type: "preview-entry-missing", workspaceId: "ws_1" },
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterReady);
  });

  it("ignores messages with the wrong source or type", async () => {
    const fetchSpy = renderReadyPreview();
    await screen.findByTitle("Demo preview");
    const callsAfterReady = fetchSpy.mock.calls.length;

    for (const data of [
      { source: "litt-welcome", type: "preview-entry-missing" },
      { source: "litt-preview", type: "something-else" },
      null,
    ]) {
      window.dispatchEvent(new MessageEvent("message", { origin: PREVIEW_ORIGIN, data }));
    }

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterReady);
  });
});
