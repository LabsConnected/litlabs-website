/**
 * Regression tests for terminal-server call timeouts.
 *
 * Covers the "Preparing preview…" eternal-spinner incident (2026-09-14):
 * every fetch in terminal-internal-client previously had NO timeout, so a
 * hung terminal server left Studio previews stuck on "starting" for hours
 * with no error and no retry. Every call must now fail loudly within a
 * bounded time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchWithTimeout,
  TERMINAL_TIMEOUTS,
  getPreviewStatusInternal,
  getWorkspaceInternal,
  getPreviewLogsInternal,
  startPreviewInternal,
  stopPreviewInternal,
  restartPreviewInternal,
  prepareWorkspaceInternal,
} from "./terminal-internal-client";

const SERVICE_KEY = "x".repeat(32);

/**
 * Like a real fetch against a hung server: never resolves on its own,
 * but rejects with AbortError when the signal aborts.
 */
function hangUntilAborted(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("This operation was aborted", "AbortError"));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function hangingFetchMock(): (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response> {
  return (_url, init) => hangUntilAborted(init?.signal as AbortSignal | null);
}

function okJson(payload: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("fetchWithTimeout", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("resolves normally when fetch responds in time", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => okJson({ ok: true }));

    const resp = await fetchWithTimeout(
      "https://example.test/x",
      { method: "POST", body: "{}" },
      1000,
      "POST /x",
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });
  });

  it("passes init through and attaches an AbortSignal", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => okJson({}));

    await fetchWithTimeout(
      "https://example.test/x",
      { method: "POST", headers: { "X-A": "b" }, body: "{}" },
      1000,
      "POST /x",
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-A": "b" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a descriptive timeout error when fetch hangs", async () => {
    vi.mocked(fetch).mockImplementation(hangingFetchMock());

    const err = await fetchWithTimeout(
      "https://example.test/internal/workspace/abc/preview/start",
      { method: "POST" },
      50,
      "POST /internal/workspace/{id}/preview/start",
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("timed out");
    expect(message).toContain("POST /internal/workspace/{id}/preview/start");
    expect(message).toContain("never completed");
  });

  it("propagates non-timeout fetch errors unchanged", async () => {
    const boom = new TypeError("fetch failed");
    vi.mocked(fetch).mockImplementation(() => Promise.reject(boom));

    const err = await fetchWithTimeout(
      "https://example.test/x",
      {},
      1000,
      "GET /x",
    ).catch((e: unknown) => e);

    expect(err).toBe(boom);
  });
});

describe("TERMINAL_TIMEOUTS", () => {
  it("defines a positive timeout for every terminal-server operation", () => {
    const keys = [
      "prepareWorkspace",
      "startPreview",
      "restartPreview",
      "getWorkspace",
      "getPreviewStatus",
      "stopPreview",
      "getPreviewLogs",
    ] as const;
    for (const key of keys) {
      expect(TERMINAL_TIMEOUTS[key]).toBeGreaterThan(0);
    }
  });

  it("gives slow operations (prepare/start) larger budgets than status checks", () => {
    expect(TERMINAL_TIMEOUTS.prepareWorkspace).toBeGreaterThan(
      TERMINAL_TIMEOUTS.getPreviewStatus,
    );
    expect(TERMINAL_TIMEOUTS.startPreview).toBeGreaterThan(
      TERMINAL_TIMEOUTS.getPreviewStatus,
    );
    expect(TERMINAL_TIMEOUTS.restartPreview).toBeGreaterThan(
      TERMINAL_TIMEOUTS.stopPreview,
    );
  });
});

describe("terminal client functions wire timeouts", () => {
  let origEnv: NodeJS.ProcessEnv;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    origEnv = { ...process.env };
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = SERVICE_KEY;
    process.env.TERMINAL_SERVER_URL = "https://terminal.test";
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = origEnv;
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it.each([
    ["prepareWorkspaceInternal", () =>
      prepareWorkspaceInternal({
        sourceType: "blank",
        userId: "u",
        projectId: "p",
        templateId: "blank-static",
      }),
    ],
    ["getWorkspaceInternal", () => getWorkspaceInternal("ws1", "u")],
    ["getPreviewStatusInternal", () => getPreviewStatusInternal("ws1", "u")],
    ["getPreviewLogsInternal", () => getPreviewLogsInternal("ws1", "u")],
    ["startPreviewInternal", () => startPreviewInternal("ws1", "u")],
    ["stopPreviewInternal", () => stopPreviewInternal("ws1", "u")],
    ["restartPreviewInternal", () => restartPreviewInternal("ws1", "u")],
  ])("%s sends an AbortSignal with fetch (timeout wired)", async (_name, invoke) => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() =>
      okJson({ workspaceId: "ws1", status: "ready", logs: [] }),
    );

    await invoke();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The only code path that attaches a signal is fetchWithTimeout.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a hung terminal server surfaces as a timeout error, not a hang", async () => {
    vi.mocked(fetch).mockImplementation(hangingFetchMock());

    const err = await getPreviewStatusInternal("ws1", "u").catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("timed out");
  }, 30_000);
});
