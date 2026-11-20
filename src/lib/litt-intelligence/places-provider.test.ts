import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isPlacesAvailable, searchPlace } from "./places-provider";

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
  vi.unstubAllEnvs();
});

describe("isPlacesAvailable", () => {
  it("is true when GOOGLE_PLACES_API_KEY is set", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    expect(isPlacesAvailable()).toBe(true);
  });

  it("is false when the key is unset or empty", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    expect(isPlacesAvailable()).toBe(false);
  });
});

describe("searchPlace", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
  });

  it("returns hours and address when a place is found", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        response({
          status: "OK",
          results: [{ place_id: "p1", name: "Best Buy", formatted_address: "123 Main St" }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          status: "OK",
          result: {
            name: "Best Buy",
            formatted_address: "123 Main St",
            opening_hours: { open_now: true, weekday_text: ["Monday: 10:00 AM – 9:00 PM"] },
            url: "https://maps.google.com/?cid=1",
          },
        }),
      );

    const result = await searchPlace("Best Buy");

    expect(result).toEqual({
      name: "Best Buy",
      address: "123 Main St",
      openNow: true,
      weekdayText: ["Monday: 10:00 AM – 9:00 PM"],
      mapsUrl: "https://maps.google.com/?cid=1",
    });
  });

  it("returns null when the text search finds no candidates", async () => {
    fetchSpy.mockResolvedValueOnce(response({ status: "ZERO_RESULTS", results: [] }));

    const result = await searchPlace("a place that does not exist anywhere");

    expect(result).toBeNull();
  });

  it("throws honestly when the API key is missing", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    await expect(searchPlace("Best Buy")).rejects.toThrow("GOOGLE_PLACES_API_KEY");
  });

  it("throws when the text search HTTP call fails", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(searchPlace("Best Buy")).rejects.toThrow("Places search failed");
  });

  it("throws (does not return null) when text search reports REQUEST_DENIED", async () => {
    fetchSpy.mockResolvedValueOnce(
      response({ status: "REQUEST_DENIED", error_message: "invalid key", results: [] }),
    );
    await expect(searchPlace("Best Buy")).rejects.toThrow("Places search failed: REQUEST_DENIED");
  });

  it("throws (does not return null) when details reports OVER_QUERY_LIMIT", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        response({
          status: "OK",
          results: [{ place_id: "p1", name: "Best Buy", formatted_address: "123 Main St" }],
        }),
      )
      .mockResolvedValueOnce(response({ status: "OVER_QUERY_LIMIT" }));
    await expect(searchPlace("Best Buy")).rejects.toThrow("Place details failed: OVER_QUERY_LIMIT");
  });
});
