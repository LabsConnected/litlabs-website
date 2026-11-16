import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  executePlacesLookup: vi.fn(),
  getUserContext: vi.fn(),
}));

vi.mock("./places-tool", () => ({
  executePlacesLookup: (...args: unknown[]) => mocks.executePlacesLookup(...args),
}));

vi.mock("./user-context", () => ({
  getUserContext: (...args: unknown[]) => mocks.getUserContext(...args),
  hasLocation: () => true,
}));

import {
  detectPlacesIntent,
  extractPlaceQuery,
  detectToolIntent,
  detectAndExecuteTool,
} from "./tool-executor";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserContext.mockResolvedValue({ userId: "user-1", capabilities: {} });
});

describe("detectPlacesIntent", () => {
  it("matches 'what time does X open' questions", () => {
    expect(detectPlacesIntent("What time does Best Buy open?")).toBe(true);
  });

  it("matches explicit hours phrasing", () => {
    expect(detectPlacesIntent("What are Target's store hours?")).toBe(true);
  });

  it("does not match unrelated Studio UI navigation phrases", () => {
    expect(detectPlacesIntent("open the terminal panel")).toBe(false);
    expect(detectPlacesIntent("open approvals")).toBe(false);
  });

  it("does not match weather questions", () => {
    expect(detectPlacesIntent("what's the weather like, is it going to rain?")).toBe(false);
  });

  it("does not match a screenshot request that happens to say 'store hours'", () => {
    expect(detectPlacesIntent("take a screenshot of the store hours page")).toBe(false);
  });

  it("does not hijack a site-editing request mentioning 'store hours'", () => {
    expect(detectPlacesIntent("Add a section with our store hours")).toBe(false);
  });

  it("does not hijack a site-editing request mentioning 'open at'", () => {
    expect(detectPlacesIntent("Update the footer to say we open at 9am")).toBe(false);
  });

  it("does not hijack a description mentioning 'opens at' that isn't a question", () => {
    expect(detectPlacesIntent("the modal opens at the top of the page")).toBe(false);
  });
});

describe("extractPlaceQuery", () => {
  it("extracts the business name from a 'what time does X open' question", () => {
    expect(extractPlaceQuery("What time does Best Buy open?")).toBe("Best Buy");
  });

  it("extracts the business name from a possessive 'X's store hours' question", () => {
    expect(extractPlaceQuery("What are Target's store hours?")).toBe("Target");
  });
});

describe("detectToolIntent — places routing", () => {
  it("routes a store-hours question to the places tool", () => {
    expect(detectToolIntent("What time does Best Buy open?")).toEqual({ tool: "places" });
  });

  it("does not hijack a web search containing the bare word 'hours'", () => {
    expect(detectToolIntent("search typical office hours in Japan")).not.toEqual({ tool: "places" });
  });

  it("does not hijack a web_fetch request for a URL path containing 'hours'", () => {
    expect(detectToolIntent("read https://mystore.com/hours")).toEqual({ tool: "web_fetch" });
  });
});

describe("detectAndExecuteTool — places", () => {
  it("executes the places tool and never falls through to the LLM for a store-hours question", async () => {
    mocks.executePlacesLookup.mockResolvedValue({
      success: true,
      data: { name: "Best Buy", address: "123 Main St", openNow: true, weekdayText: [], mapsUrl: null },
      formatted: "Best Buy (123 Main St) is open now. Source: Google Places.",
    });

    const result = await detectAndExecuteTool("user-1", "What time does Best Buy open?");

    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("places");
    expect(result.text).toContain("Source: Google Places");
    expect(mocks.executePlacesLookup).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "Best Buy",
    );
  });
});
