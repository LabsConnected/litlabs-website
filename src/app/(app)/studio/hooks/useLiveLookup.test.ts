import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveLookup } from "./useLiveLookup";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLiveLookup", () => {
  it("starts with no result, no error, not loading", () => {
    const { result } = renderHook(() => useLiveLookup());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("posts the query and exposes the formatted, sourced result", async () => {
    fetchSpy.mockResolvedValue(
      response({
        success: true,
        formatted: "Best Buy (123 Main St) is open now. Source: Google Places.",
        source: "Google Places",
      }),
    );

    const { result } = renderHook(() => useLiveLookup());
    await act(async () => {
      await result.current.search("What time does Best Buy open?");
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/studio/lookup",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.result?.formatted).toContain("Source: Google Places");
    expect(result.current.result?.source).toBe("Google Places");
  });

  it("exposes the honest error message instead of a result on failure", async () => {
    fetchSpy.mockResolvedValue(response({ success: false, error: "I couldn't find a match for \"nowhere\"." }));

    const { result } = renderHook(() => useLiveLookup());
    await act(async () => {
      await result.current.search("nowhere hours");
    });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toContain("couldn't find a match");
  });

  it("does nothing for a blank query", async () => {
    const { result } = renderHook(() => useLiveLookup());
    await act(async () => {
      await result.current.search("   ");
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
