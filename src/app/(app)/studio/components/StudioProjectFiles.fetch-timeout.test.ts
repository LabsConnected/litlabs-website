import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchWithTimeout } from "./StudioProjectFiles";

/**
 * Regression tests: the Files tab intermittently wedged on
 * "Loading files…" forever. Root cause: the workspace-prepare retry path
 * (and every other requestJson call) had no timeout — a stalled request
 * never resolved, never errored, and the spinner never cleared.
 * fetchWithTimeout bounds every request so a hang becomes an honest,
 * retryable error instead.
 */
describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the response and passes an abort signal through", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const result = await fetchWithTimeout("/api/x", {}, 5_000);
    expect(result).toBe(response);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects with a clear timeout message when the request hangs", async () => {
    // Simulate a hung request that honors abort, like a real fetch would.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    await expect(fetchWithTimeout("/api/hung", {}, 50)).rejects.toThrow(/timed out/i);
  });

  it("propagates non-abort errors unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    await expect(fetchWithTimeout("/api/x", {}, 5_000)).rejects.toThrow("network down");
  });

  it("respects a caller-provided signal instead of installing its own", async () => {
    const controller = new AbortController();
    const response = new Response("{}", { status: 200 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await fetchWithTimeout("/api/x", { signal: controller.signal }, 5_000);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});
