import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserContext } from "./user-context";

/**
 * Regression tests for the chat realtime web path:
 *
 * The in-Studio agent answered "Not yet. I can't browse the web right
 * now" because executeWebSearch reported "not available" whenever the
 * optional BRAVE_SEARCH_API_KEY was unset — even though the codebase's
 * canonical web tools (tool registry → @litt/agent-core, DuckDuckGo +
 * SSRF-safe fetch) need no key. These tests pin the keyless fallback
 * and the URL fetch helper.
 */

const mocks = vi.hoisted(() => ({
  braveAvailable: true,
  braveSearch: vi.fn(),
  registryExecute: vi.fn(),
}));

vi.mock("./web-search-provider", () => ({
  isWebSearchAvailable: () => mocks.braveAvailable,
  searchWeb: (query: string) => mocks.braveSearch(query),
  formatSearchResults: (r: { results: unknown[] }) =>
    `brave formatted (${r.results.length} results)`,
}));

vi.mock("./permission-gate", () => ({
  checkPermission: () => ({ allowed: true }),
  recordToolCall: vi.fn(async () => {}),
}));

vi.mock("./tool-registry", () => ({
  toolRegistry: {
    execute: (id: string, inputs: Record<string, unknown>, opts: unknown) =>
      mocks.registryExecute(id, inputs, opts),
  },
}));

vi.mock("./capabilities", () => ({
  resolveAvailableCapabilities: () => ["web_search", "image_generation"],
}));

import { executeWebSearch, executeWebFetch, formatCoreSearchResults } from "./web-search-tool";

const ctx = { userId: "user-1", capabilities: {} } as unknown as UserContext;

const CORE_RESULT = {
  query: "what is litlabs",
  answer: null,
  abstract: "LiTTree LabStudios builds LiTT, an AI project operator.",
  abstractSource: "LiTTree LabStudios",
  abstractUrl: "https://litlabs.net",
  relatedTopics: [{ text: "LiTT Studio overview", url: "https://litlabs.net/studio" }],
  empty: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.braveAvailable = true;
});

describe("executeWebSearch", () => {
  it("uses Brave when the API key is configured", async () => {
    mocks.braveSearch.mockResolvedValue({ query: "q", fetchedAt: 0, results: [{ title: "t", url: "u", description: "d" }] });

    const res = await executeWebSearch(ctx, "q");

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.provider).toBe("brave_search");
      expect(res.formatted).toContain("brave formatted");
    }
    expect(mocks.registryExecute).not.toHaveBeenCalled();
  });

  it("falls back to the keyless agent-core search when no Brave key is configured", async () => {
    mocks.braveAvailable = false;
    mocks.registryExecute.mockResolvedValue({ ok: true, result: CORE_RESULT });

    const res = await executeWebSearch(ctx, "what is litlabs");

    expect(mocks.braveSearch).not.toHaveBeenCalled();
    expect(mocks.registryExecute).toHaveBeenCalledWith(
      "web.search",
      { query: "what is litlabs" },
      expect.objectContaining({ availableCapabilities: expect.arrayContaining(["web_search"]) }),
    );
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.provider).toBe("duckduckgo");
      // The formatted answer cites its sources.
      expect(res.formatted).toContain("https://litlabs.net");
      expect(res.formatted).toContain("https://litlabs.net/studio");
    }
  });

  it("surfaces the registry error honestly when the keyless search fails", async () => {
    mocks.braveAvailable = false;
    mocks.registryExecute.mockResolvedValue({ ok: false, error: "Tool \"web.search\" is disabled" });

    const res = await executeWebSearch(ctx, "anything");

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("disabled");
  });
});

describe("executeWebFetch", () => {
  it("fetches page content through the registry's SSRF-safe web.fetch", async () => {
    mocks.registryExecute.mockResolvedValue({
      ok: true,
      result: {
        url: "https://example.com/page",
        status: 200,
        ok: true,
        contentType: "text/html",
        content: "Hello from the page",
        truncated: false,
      },
    });

    const res = await executeWebFetch(ctx, "https://example.com/page");

    expect(mocks.registryExecute).toHaveBeenCalledWith(
      "web.fetch",
      { url: "https://example.com/page" },
      expect.objectContaining({ availableCapabilities: expect.arrayContaining(["web_search"]) }),
    );
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.formatted).toContain("https://example.com/page");
      expect(res.formatted).toContain("Hello from the page");
    }
  });

  it("returns the honest error when the fetch is blocked", async () => {
    mocks.registryExecute.mockResolvedValue({ ok: false, error: "blocked: private IP" });

    const res = await executeWebFetch(ctx, "https://169.254.169.254/latest");

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("blocked");
  });
});

describe("formatCoreSearchResults", () => {
  it("reports an honest empty state instead of inventing results", () => {
    const text = formatCoreSearchResults({
      query: "obscure query",
      answer: null,
      abstract: null,
      abstractSource: null,
      abstractUrl: null,
      relatedTopics: [],
      empty: true,
    });
    expect(text).toContain("found no instant answer");
  });
});
