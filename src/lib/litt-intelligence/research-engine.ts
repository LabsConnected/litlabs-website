/**
 * Research and Discovery Engine
 *
 * Provides real research capabilities for current external information.
 * Uses a provider-based architecture so search/crawl backends are
 * swappable — no hardwired vendor dependency.
 *
 * Source hierarchy (preferred first):
 *   1. Official project documentation
 *   2. Official GitHub repository
 *   3. Official API specification
 *   4. Official changelog or release notes
 *   5. Package registry metadata
 *   6. Maintainer issues and discussions
 *   7. High-quality independent analysis
 *   8. Community discussions (supporting evidence only)
 *
 * Never makes Reddit, random blogs, or generated listicles the primary
 * technical source when official sources exist.
 */

import { randomUUID } from "crypto";
import type {
  ResearchQuery,
  SearchResult,
  ResearchSource,
  FetchedSource,
  VerificationResult,
  VerificationCheck,
} from "./types";

// ─── Provider Interface ─────────────────────────────────────────

export interface ResearchProvider {
  name: string;
  search(query: ResearchQuery): Promise<SearchResult[]>;
  fetch(source: ResearchSource): Promise<FetchedSource | null>;
  verify(source: FetchedSource): Promise<VerificationResult>;
}

// ─── Source type ranking ────────────────────────────────────────

const SOURCE_TYPE_RANK: Record<string, number> = {
  official_documentation: 1,
  official_repository: 2,
  official_api_spec: 3,
  official_changelog: 4,
  package_registry: 5,
  maintainer_discussion: 6,
  independent_analysis: 7,
  community_discussion: 8,
  unknown: 99,
};

function rankSourceType(type: string): number {
  return SOURCE_TYPE_RANK[type] ?? 99;
}

// ─── Research Engine ────────────────────────────────────────────

export class ResearchEngine {
  private providers: ResearchProvider[] = [];

  registerProvider(provider: ResearchProvider): void {
    this.providers.push(provider);
  }

  /**
   * Execute a research query across all registered providers.
   * Results are merged, deduplicated, and ranked by source type.
   */
  async search(query: ResearchQuery): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    for (const provider of this.providers) {
      try {
        const results = await provider.search(query);
        allResults.push(...results);
      } catch (err) {
        console.error(
          `[research:search] Provider ${provider.name} failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const deduped = allResults.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // Sort by source type rank, then by relevance score
    deduped.sort((a, b) => {
      const typeRankDiff = rankSourceType(a.sourceType) - rankSourceType(b.sourceType);
      if (typeRankDiff !== 0) return typeRankDiff;
      return b.relevanceScore - a.relevanceScore;
    });

    return deduped;
  }

  /**
   * Fetch a source's full content using the first provider that
   * supports it.
   */
  async fetch(source: ResearchSource): Promise<FetchedSource | null> {
    for (const provider of this.providers) {
      try {
        const fetched = await provider.fetch(source);
        if (fetched) return fetched;
      } catch (err) {
        console.error(
          `[research:fetch] Provider ${provider.name} failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return null;
  }

  /**
   * Verify a fetched source using all providers.
   * Aggregates verification checks.
   */
  async verify(source: FetchedSource): Promise<VerificationResult> {
    const allChecks: VerificationCheck[] = [];
    const allWarnings: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.verify(source);
        allChecks.push(...result.checks);
        allWarnings.push(...result.warnings);
      } catch (err) {
        console.error(
          `[research:verify] Provider ${provider.name} failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const verified = allChecks.length > 0 && allChecks.every((c) => c.passed);

    return {
      source,
      verified,
      checks: allChecks,
      warnings: allWarnings,
    };
  }

  /**
   * Full research pipeline: search → fetch → verify.
   * Returns verified sources with their content and verification status.
   */
  async research(query: ResearchQuery): Promise<ResearchResult> {
    const searchResults = await this.search(query);

    // Fetch top results (limit to avoid excessive requests)
    const topResults = searchResults.slice(0, 5);
    const fetched: Array<{ search: SearchResult; source: FetchedSource | null; verification: VerificationResult | null }> = [];

    for (const result of topResults) {
      const source = await this.fetch({ url: result.url, sourceType: result.sourceType, title: result.title });
      let verification: VerificationResult | null = null;

      if (source) {
        verification = await this.verify(source);
      }

      fetched.push({ search: result, source, verification });
    }

    return {
      query,
      results: fetched,
      summary: this.summarize(fetched),
    };
  }

  private summarize(
    fetched: Array<{ search: SearchResult; source: FetchedSource | null; verification: VerificationResult | null }>,
  ): string {
    const verified = fetched.filter((f) => f.verification?.verified);
    const unverified = fetched.filter((f) => f.source && !f.verification?.verified);
    const failed = fetched.filter((f) => !f.source);

    const lines: string[] = [
      `Research summary: ${verified.length} verified, ${unverified.length} unverified, ${failed.length} failed to fetch.`,
    ];

    if (verified.length > 0) {
      lines.push("Verified sources:");
      for (const v of verified) {
        lines.push(`  - ${v.search.title} (${v.search.sourceType}): ${v.search.url}`);
      }
    }

    return lines.join("\n");
  }
}

// ─── Research result type ───────────────────────────────────────

export interface ResearchResult {
  query: ResearchQuery;
  results: Array<{
    search: SearchResult;
    source: FetchedSource | null;
    verification: VerificationResult | null;
  }>;
  summary: string;
}

// ─── Query planning ─────────────────────────────────────────────

/**
 * Convert a user request into focused research subqueries.
 * This is a deterministic planner — it does NOT call an LLM.
 */
export function planResearchQuery(
  userMessage: string,
  constraints: string[] = [],
): ResearchQuery {
  const id = `rq-${randomUUID()}`;
  const subqueries: string[] = [];

  // Extract key terms from the message
  const lowerMessage = userMessage.toLowerCase();

  // Generate subqueries based on common research patterns
  if (/open.?source|free|self.?host/i.test(lowerMessage)) {
    subqueries.push("open source solution");
    subqueries.push("self-hosted alternative");
    subqueries.push("free tier API");
  }

  if (/api|integration|connect/i.test(lowerMessage)) {
    subqueries.push("API documentation");
    subqueries.push("OpenAPI specification");
    subqueries.push("integration guide");
  }

  if (/license|commercial/i.test(lowerMessage)) {
    subqueries.push("license terms");
    subqueries.push("commercial use permissions");
  }

  if (/compare|vs|versus|alternative/i.test(lowerMessage)) {
    subqueries.push("comparison");
    subqueries.push("alternatives");
  }

  // Always include the original message as a subquery
  subqueries.push(userMessage);

  // Add constraint-based subqueries
  for (const constraint of constraints) {
    subqueries.push(`${userMessage} ${constraint}`);
  }

  return {
    id,
    text: userMessage,
    subqueries: [...new Set(subqueries)],
    intent: detectResearchIntent(lowerMessage),
    constraints,
  };
}

function detectResearchIntent(message: string): string {
  if (/find|search|look for|discover/i.test(message)) return "discover";
  if (/compare|vs|versus|alternative/i.test(message)) return "compare";
  if (/verify|check|validate/i.test(message)) return "verify";
  if (/integrate|connect|add/i.test(message)) return "integrate";
  return "general";
}

// ─── Factory: create a fully-wired ResearchEngine ────────────────

/**
 * Create a ResearchEngine with all available providers registered,
 * including the Browserbase provider (if BROWSERBASE_API_KEY is set).
 * Providers that lack their required env vars are silently skipped.
 */
export async function createResearchEngine(): Promise<ResearchEngine> {
  const engine = new ResearchEngine();

  // Register Browserbase provider (Search + Fetch API) — highest priority
  // because it's the most capable and cost-effective fast path.
  const { getBrowserbaseProvider } = await import("./browserbase-provider");
  const bbProvider = getBrowserbaseProvider();
  if (bbProvider) {
    engine.registerProvider(bbProvider);
  }

  // Register existing providers (they self-skip if env vars are missing)
  const { GitHubSearchProvider, WebSearchProvider, PackageRegistryProvider, OpenAPIDirectoryProvider } = await import("./research-providers");
  engine.registerProvider(new GitHubSearchProvider());
  engine.registerProvider(new WebSearchProvider());
  engine.registerProvider(new PackageRegistryProvider());
  engine.registerProvider(new OpenAPIDirectoryProvider());

  return engine;
}
