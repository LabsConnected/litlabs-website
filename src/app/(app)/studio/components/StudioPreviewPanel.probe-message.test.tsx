import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StudioPreviewPanel from "./StudioPreviewPanel";

// Round 14 (2026-11-17): the frame probe's thrown-fetch case used to
// print one message — "The preview address did not respond" — for
// two different failures: (a) the probe's own 20 s timer fired
// because the address was reached but never answered (a black-holed
// upstream makes the terminal proxy hang past the probe budget),
// and (b) the request never completed at all (network failure or a
// cross-origin rejection in the browser). The proof's attempt 1 hit
// exactly this ambiguity. The probe now says which one happened.

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn().mockResolvedValue("test-token") }));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TOUCHED_NO_CODE = { scaffolded: false, touched: true, starterContent: false };

const READY_GET = {
  runtimeStatus: "ready",
  previewUrl: "https://proxy.test/ws-1",
  runtimeError: null,
  runtimeErrorCode: null,
};

function mockFetch(probeImpl: (init?: RequestInit) => Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/workspace-state")) return jsonResponse(TOUCHED_NO_CODE);
    if (url.includes("/preview")) return jsonResponse(READY_GET);
    if (url.startsWith("https://proxy.test")) return probeImpl(init as RequestInit | undefined);
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

describe("StudioPreviewPanel — frame probe failure message split (round 14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a fetch that never completes (network/CORS throw) says the address could not be reached from the browser", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    renderPanel();

    expect(
      await screen.findByText(/could not be reached from your browser/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/did not answer in time/)).toBeNull();
  }, 20000);

  it("a probe that hangs until its own timeout says the address did not answer in time", async () => {
    vi.useFakeTimers();
    mockFetch(async (init) => {
      // Never answers on its own — rejects only when the probe's
      // AbortController fires (the 20 s FRAME_PROBE_TIMEOUT_MS).
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });
    renderPanel();

    // Let the mount effects + status fetch settle, then run the
    // probe timer out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByText(/did not answer in time/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be reached from your browser/)).toBeNull();
  }, 20000);

  it("an HTTP error from the address keeps the status-specific message (not either throw message)", async () => {
    mockFetch(async () => new Response("nope", { status: 502 }));
    renderPanel();

    expect(
      await screen.findByText(/returned HTTP 502/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not be reached from your browser/)).toBeNull();
    expect(screen.queryByText(/did not answer in time/)).toBeNull();
  }, 20000);
});
