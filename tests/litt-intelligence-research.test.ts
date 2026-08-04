import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResearchEngine, planResearchQuery } from "@/lib/litt-intelligence/research-engine";
import type { ResearchProvider } from "@/lib/litt-intelligence/research-engine";
import type {
  ResearchQuery,
  SearchResult,
  ResearchSource,
  FetchedSource,
  VerificationResult,
} from "@/lib/litt-intelligence/types";

// ─── Mock provider ──────────────────────────────────────────────

function createMockProvider(
  name: string,
  searchResults: SearchResult[] = [],
  fetchedContent: FetchedSource | null = null,
  verification: VerificationResult | null = null,
): ResearchProvider {
  return {
    name,
    search: vi.fn().mockResolvedValue(searchResults),
    fetch: vi.fn().mockResolvedValue(fetchedContent),
    verify: vi.fn().mockResolvedValue(
      verification ?? {
        source: fetchedContent ?? { url: "", title: "", content: "", contentType: "text/html", fetchedAt: "", statusCode: 200 },
        verified: true,
        checks: [{ name: "mock_check", passed: true, detail: "mock" }],
        warnings: [],
      },
    ),
  };
}

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: `sr-${Math.random().toString(36).slice(2)}`,
    title: "Test Result",
    url: "https://example.com/test",
    sourceType: "official_documentation",
    snippet: "Test snippet",
    relevanceScore: 0.8,
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFetchedSource(overrides: Partial<FetchedSource> = {}): FetchedSource {
  return {
    url: "https://example.com/test",
    title: "Test Source",
    content: "This is test content with enough length to pass verification checks.",
    contentType: "text/html",
    fetchedAt: new Date().toISOString(),
    statusCode: 200,
    ...overrides,
  };
}

describe("LiTT Intelligence — Research Engine", () => {
  // ─── Query planning ────────────────────────────────────────────

  it("planResearchQuery generates subqueries from user message", () => {
    const query = planResearchQuery("Find a free open-source image background removal tool");
    expect(query.text).toBe("Find a free open-source image background removal tool");
    expect(query.subqueries.length).toBeGreaterThan(0);
    expect(query.subqueries).toContain("Find a free open-source image background removal tool");
  });

  it("planResearchQuery detects 'discover' intent", () => {
    const query = planResearchQuery("Find an open-source CMS");
    expect(query.intent).toBe("discover");
  });

  it("planResearchQuery detects 'compare' intent", () => {
    const query = planResearchQuery("Compare Next.js vs Remix");
    expect(query.intent).toBe("compare");
  });

  it("planResearchQuery detects 'verify' intent", () => {
    const query = planResearchQuery("Verify that Stripe supports webhooks");
    expect(query.intent).toBe("verify");
  });

  it("planResearchQuery detects 'integrate' intent", () => {
    const query = planResearchQuery("Add image generation to my project");
    expect(query.intent).toBe("integrate");
  });

  it("planResearchQuery defaults to 'general' intent", () => {
    const query = planResearchQuery("Tell me about black holes");
    expect(query.intent).toBe("general");
  });

  it("planResearchQuery includes constraints in subqueries", () => {
    const query = planResearchQuery("Find a CMS", ["TypeScript compatible", "MIT license"]);
    expect(query.constraints).toContain("TypeScript compatible");
    expect(query.constraints).toContain("MIT license");
    expect(query.subqueries.some((sq) => sq.includes("TypeScript compatible"))).toBe(true);
  });

  it("planResearchQuery generates open-source subqueries for OSS requests", () => {
    const query = planResearchQuery("Find a free open-source tool");
    expect(query.subqueries).toContain("open source solution");
    expect(query.subqueries).toContain("self-hosted alternative");
  });

  it("planResearchQuery generates API subqueries for integration requests", () => {
    const query = planResearchQuery("Connect to the Stripe API");
    expect(query.subqueries).toContain("API documentation");
    expect(query.subqueries).toContain("OpenAPI specification");
  });

  it("planResearchQuery generates license subqueries for license requests", () => {
    const query = planResearchQuery("Check the license for commercial use");
    expect(query.subqueries).toContain("license terms");
    expect(query.subqueries).toContain("commercial use permissions");
  });

  // ─── Engine search ─────────────────────────────────────────────

  it("search aggregates results from all providers", async () => {
    const provider1 = createMockProvider("p1", [
      makeSearchResult({ id: "r1", url: "https://example.com/1", title: "Result 1" }),
    ]);
    const provider2 = createMockProvider("p2", [
      makeSearchResult({ id: "r2", url: "https://example.com/2", title: "Result 2" }),
    ]);

    const engine = new ResearchEngine();
    engine.registerProvider(provider1);
    engine.registerProvider(provider2);

    const query: ResearchQuery = { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] };
    const results = await engine.search(query);

    expect(results).toHaveLength(2);
    expect(results.some((r) => r.url === "https://example.com/1")).toBe(true);
    expect(results.some((r) => r.url === "https://example.com/2")).toBe(true);
  });

  it("search deduplicates by URL", async () => {
    const provider1 = createMockProvider("p1", [
      makeSearchResult({ id: "r1", url: "https://example.com/dup", title: "Result 1" }),
    ]);
    const provider2 = createMockProvider("p2", [
      makeSearchResult({ id: "r2", url: "https://example.com/dup", title: "Result 2" }),
    ]);

    const engine = new ResearchEngine();
    engine.registerProvider(provider1);
    engine.registerProvider(provider2);

    const query: ResearchQuery = { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] };
    const results = await engine.search(query);

    expect(results).toHaveLength(1);
  });

  it("search ranks official documentation above community discussion", async () => {
    const provider = createMockProvider("p1", [
      makeSearchResult({ id: "r1", url: "https://reddit.com/thread", sourceType: "community_discussion", title: "Reddit Thread", relevanceScore: 0.9 }),
      makeSearchResult({ id: "r2", url: "https://docs.example.com/api", sourceType: "official_documentation", title: "Official Docs", relevanceScore: 0.5 }),
    ]);

    const engine = new ResearchEngine();
    engine.registerProvider(provider);

    const query: ResearchQuery = { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] };
    const results = await engine.search(query);

    expect(results[0].sourceType).toBe("official_documentation");
    expect(results[1].sourceType).toBe("community_discussion");
  });

  it("search continues when a provider fails", async () => {
    const failingProvider: ResearchProvider = {
      name: "failing",
      search: vi.fn().mockRejectedValue(new Error("Network error")),
      fetch: vi.fn(),
      verify: vi.fn(),
    };
    const goodProvider = createMockProvider("good", [
      makeSearchResult({ id: "r1", url: "https://example.com/1" }),
    ]);

    const engine = new ResearchEngine();
    engine.registerProvider(failingProvider);
    engine.registerProvider(goodProvider);

    const query: ResearchQuery = { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] };
    const results = await engine.search(query);

    expect(results).toHaveLength(1);
  });

  it("search returns empty when no providers registered", async () => {
    const engine = new ResearchEngine();
    const query: ResearchQuery = { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] };
    const results = await engine.search(query);
    expect(results).toHaveLength(0);
  });

  // ─── Engine fetch ──────────────────────────────────────────────

  it("fetch returns content from first provider that succeeds", async () => {
    const fetched = makeFetchedSource();
    const provider1 = createMockProvider("p1", [], null);
    const provider2 = createMockProvider("p2", [], fetched);

    const engine = new ResearchEngine();
    engine.registerProvider(provider1);
    engine.registerProvider(provider2);

    const source: ResearchSource = { url: "https://example.com/test", sourceType: "official_documentation" };
    const result = await engine.fetch(source);

    expect(result).not.toBeNull();
    expect(result!.url).toBe("https://example.com/test");
  });

  it("fetch returns null when all providers fail", async () => {
    const provider1 = createMockProvider("p1", [], null);

    const engine = new ResearchEngine();
    engine.registerProvider(provider1);

    const source: ResearchSource = { url: "https://example.com/test", sourceType: "official_documentation" };
    const result = await engine.fetch(source);

    expect(result).toBeNull();
  });

  // ─── Engine verify ─────────────────────────────────────────────

  it("verify aggregates checks from all providers", async () => {
    const fetched = makeFetchedSource();
    const provider1: ResearchProvider = {
      name: "p1",
      search: vi.fn(),
      fetch: vi.fn(),
      verify: vi.fn().mockResolvedValue({
        source: fetched,
        verified: true,
        checks: [{ name: "check1", passed: true, detail: "ok" }],
        warnings: ["warning1"],
      }),
    };
    const provider2: ResearchProvider = {
      name: "p2",
      search: vi.fn(),
      fetch: vi.fn(),
      verify: vi.fn().mockResolvedValue({
        source: fetched,
        verified: true,
        checks: [{ name: "check2", passed: true, detail: "ok" }],
        warnings: ["warning2"],
      }),
    };

    const engine = new ResearchEngine();
    engine.registerProvider(provider1);
    engine.registerProvider(provider2);

    const result = await engine.verify(fetched);

    expect(result.checks).toHaveLength(2);
    expect(result.warnings).toContain("warning1");
    expect(result.warnings).toContain("warning2");
    expect(result.verified).toBe(true);
  });

  it("verify is false when any check fails", async () => {
    const fetched = makeFetchedSource();
    const provider: ResearchProvider = {
      name: "p1",
      search: vi.fn(),
      fetch: vi.fn(),
      verify: vi.fn().mockResolvedValue({
        source: fetched,
        verified: false,
        checks: [
          { name: "check1", passed: true, detail: "ok" },
          { name: "check2", passed: false, detail: "failed" },
        ],
        warnings: [],
      }),
    };

    const engine = new ResearchEngine();
    engine.registerProvider(provider);

    const result = await engine.verify(fetched);

    expect(result.verified).toBe(false);
  });

  // ─── Full research pipeline ────────────────────────────────────

  it("research pipeline returns results with fetch and verification", async () => {
    const fetched = makeFetchedSource();
    const searchResults = [
      makeSearchResult({ id: "r1", url: "https://example.com/1", title: "Result 1" }),
      makeSearchResult({ id: "r2", url: "https://example.com/2", title: "Result 2" }),
    ];

    const provider = createMockProvider("p1", searchResults, fetched);
    const engine = new ResearchEngine();
    engine.registerProvider(provider);

    const query = planResearchQuery("Find a test library");
    const result = await engine.research(query);

    expect(result.query).toBe(query);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].search).toBeDefined();
    expect(result.results[0].source).toBeDefined();
    expect(result.results[0].verification).toBeDefined();
    expect(result.summary).toContain("verified");
  });

  it("research pipeline handles fetch failures gracefully", async () => {
    const searchResults = [makeSearchResult({ id: "r1", url: "https://example.com/1" })];
    const provider = createMockProvider("p1", searchResults, null);

    const engine = new ResearchEngine();
    engine.registerProvider(provider);

    const query = planResearchQuery("Find a test library");
    const result = await engine.research(query);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBeNull();
    expect(result.summary).toContain("failed");
  });

  // ─── Source type ranking ───────────────────────────────────────

  it("official_documentation ranks above package_registry", async () => {
    const provider = createMockProvider("p1", [
      makeSearchResult({ id: "r1", url: "https://npmjs.com/pkg", sourceType: "package_registry", relevanceScore: 0.9 }),
      makeSearchResult({ id: "r2", url: "https://docs.example.com", sourceType: "official_documentation", relevanceScore: 0.5 }),
    ]);

    const engine = new ResearchEngine();
    engine.registerProvider(provider);

    const query: ResearchQuery = { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] };
    const results = await engine.search(query);

    expect(results[0].sourceType).toBe("official_documentation");
  });

  it("official_repository ranks above community_discussion", async () => {
    const provider = createMockProvider("p1", [
      makeSearchResult({ id: "r1", url: "https://reddit.com", sourceType: "community_discussion", relevanceScore: 0.95 }),
      makeSearchResult({ id: "r2", url: "https://github.com/repo", sourceType: "official_repository", relevanceScore: 0.3 }),
    ]);

    const engine = new ResearchEngine();
    engine.registerProvider(provider);

    const query: ResearchQuery = { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] };
    const results = await engine.search(query);

    expect(results[0].sourceType).toBe("official_repository");
  });
});
