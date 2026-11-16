import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserContext } from "./user-context";

const mocks = vi.hoisted(() => ({
  placesAvailable: true,
  searchPlace: vi.fn(),
  recordToolCall: vi.fn(async () => {}),
}));

vi.mock("./places-provider", () => ({
  isPlacesAvailable: () => mocks.placesAvailable,
  searchPlace: (query: string) => mocks.searchPlace(query),
  formatPlaceResult: (place: { name: string; address: string }) =>
    `${place.name} (${place.address}) formatted`,
}));

vi.mock("./permission-gate", () => ({
  checkPermission: () => ({ allowed: true }),
  recordToolCall: mocks.recordToolCall,
}));

import { executePlacesLookup } from "./places-tool";

const ctx = { userId: "user-1", capabilities: {} } as unknown as UserContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.placesAvailable = true;
});

describe("executePlacesLookup", () => {
  it("returns a formatted, sourced answer when a place is found", async () => {
    mocks.searchPlace.mockResolvedValue({
      name: "Best Buy",
      address: "123 Main St",
      openNow: true,
      weekdayText: [],
      mapsUrl: null,
    });

    const res = await executePlacesLookup(ctx, "Best Buy");

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.formatted).toContain("Best Buy (123 Main St) formatted");
    }
    expect(mocks.recordToolCall).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ capabilityId: "places.search", success: true }),
    );
  });

  it("reports an honest 'not configured' message when no key is set", async () => {
    mocks.placesAvailable = false;

    const res = await executePlacesLookup(ctx, "Best Buy");

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("GOOGLE_PLACES_API_KEY");
    expect(mocks.searchPlace).not.toHaveBeenCalled();
  });

  it("reports an honest 'not found' message instead of guessing", async () => {
    mocks.searchPlace.mockResolvedValue(null);

    const res = await executePlacesLookup(ctx, "a place that does not exist");

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("couldn't find a match");
    expect(mocks.recordToolCall).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ capabilityId: "places.search", success: false }),
    );
  });

  it("surfaces a provider failure honestly", async () => {
    mocks.searchPlace.mockRejectedValue(new Error("Places search failed: 500"));

    const res = await executePlacesLookup(ctx, "Best Buy");

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Places search failed: 500");
  });
});
