import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression test for an SSRF gap in the research providers.
 *
 * WebSearchProvider.fetch(), GitHubSearchProvider.fetch(), and
 * OpenAPIDirectoryProvider.fetch() all take a `source.url` that originates
 * from externally-sourced content (a search engine result, a GitHub search
 * hit, or a third-party API catalog entry) and previously passed it straight
 * to the raw global `fetch()` with no SSRF guard. A poisoned or adversarial
 * search result pointing at an internal address (cloud metadata service,
 * localhost, a private-network service) would be fetched server-side with
 * no restriction.
 *
 * The fix routes these through `safeFetch` from @litt/agent-core, the same
 * SSRF-safe boundary already used by the `web.fetch` tool — it blocks
 * localhost, private/link-local IPs (including the 169.254.169.254 cloud
 * metadata address) both by literal IP and by DNS resolution.
 */

import { WebSearchProvider, GitHubSearchProvider, OpenAPIDirectoryProvider } from "./research-providers";

const realFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn(async () => {
    throw new Error("global fetch should never be reached for a blocked SSRF target");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

const SSRF_TARGETS = [
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  "http://localhost:6379/",
  "http://127.0.0.1:8080/internal",
];

describe("research providers — SSRF boundary", () => {
  it("WebSearchProvider.fetch never reaches an internal/metadata target", async () => {
    const provider = new WebSearchProvider();
    for (const url of SSRF_TARGETS) {
      const result = await provider.fetch({ url, sourceType: "web_search" });
      expect(result).toBeNull();
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("GitHubSearchProvider.fetch never reaches an internal/metadata target", async () => {
    const provider = new GitHubSearchProvider();
    for (const url of SSRF_TARGETS) {
      const result = await provider.fetch({ url, sourceType: "official_repository" });
      expect(result).toBeNull();
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("OpenAPIDirectoryProvider.fetch never reaches an internal/metadata target", async () => {
    const provider = new OpenAPIDirectoryProvider();
    for (const url of SSRF_TARGETS) {
      const result = await provider.fetch({ url, sourceType: "official_api_spec" });
      expect(result).toBeNull();
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still fetches a normal public URL (sanity check the guard isn't overbroad)", async () => {
    global.fetch = vi.fn(async () =>
      new Response("<html>hello</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;

    const provider = new WebSearchProvider();
    const result = await provider.fetch({ url: "https://example.com/docs", sourceType: "web_search" });
    expect(result).not.toBeNull();
    expect(result?.content).toContain("hello");
  });
});
