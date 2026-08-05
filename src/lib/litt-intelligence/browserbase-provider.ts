/**
 * Browserbase Research Provider
 *
 * Implements the existing ResearchProvider interface so Browserbase's
 * Search and Fetch APIs slot into the existing ResearchEngine without
 * duplicating the orchestration layer.
 *
 * Escalation strategy (cheapest first):
 *   1. Browserbase Search API — discover URLs for a query (no browser)
 *   2. Browserbase Fetch API — lightweight HTTP fetch (no browser)
 *   3. (Browser escalation is handled by web-intelligence.ts, not here)
 *
 * Security: BROWSERBASE_API_KEY is server-side only. This module is
 * marked "server-only" and must never be imported by client code.
 */

import "server-only";
import { randomUUID } from "crypto";
import Browserbase from "@browserbasehq/sdk";
import type {
  ResearchQuery,
  SearchResult,
  ResearchSource,
  FetchedSource,
  VerificationResult,
  VerificationCheck,
} from "./types";
import type { ResearchProvider } from "./research-engine";

// ─── Helpers ─────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.BROWSERBASE_API_KEY;
  if (!key) throw new Error("BROWSERBASE_API_KEY is not configured");
  return key;
}

function hasApiKey(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim());
}

/** Classify a URL into the existing source-type taxonomy. */
function classifyUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("github.com")) return "official_repository";
  if (/docs\./.test(lower) || /documentation/.test(lower)) return "official_documentation";
  if (lower.includes("npmjs.com") || lower.includes("pypi.org")) return "package_registry";
  if (/reddit\.com|stackoverflow\.com|hn\.|news\.ycombinator/.test(lower)) return "community_discussion";
  if (/arxiv\.org|scholar\.google|doi\.org|semanticscholar/.test(lower)) return "research_paper";
  if (/cnn\.com|bbc\.|reuters|nytimes|washingtonpost|bloomberg/.test(lower)) return "news";
  return "independent_analysis";
}

/** Extract domain from URL for display. */
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── Provider ────────────────────────────────────────────────────

/**
 * Browserbase-backed research provider.
 *
 * Uses the Browserbase Search API for discovery and the Fetch API for
 * content retrieval. Both are lightweight (no full browser session),
 * making them the cost-effective first tier in the escalation chain.
 *
 * Browser escalation (Stagehand) is handled by the web-intelligence
 * module, not this provider — this keeps the provider focused on the
 * fast path and lets the orchestrator decide when to spin up a browser.
 */
export class BrowserbaseResearchProvider implements ResearchProvider {
  name = "browserbase";

  private client: Browserbase | null = null;

  private getClient(): Browserbase {
    if (!this.client) {
      this.client = new Browserbase({ apiKey: getApiKey() });
    }
    return this.client;
  }

  /**
   * Search the web using the Browserbase Search API.
   * Returns structured results with URLs, titles, and snippets.
   */
  async search(query: ResearchQuery): Promise<SearchResult[]> {
    if (!hasApiKey()) return [];

    const results: SearchResult[] = [];
    const searchTerm = query.subqueries[0] ?? query.text;

    try {
      const bb = this.getClient();
      const response = await bb.search.web({
        query: searchTerm,
        numResults: 10,
      });

      for (const item of response.results ?? []) {
        if (!item.url) continue;
        results.push({
          id: `bb-search-${randomUUID()}`,
          title: item.title ?? item.url,
          url: item.url,
          sourceType: classifyUrl(item.url),
          snippet: item.author ?? item.publishedDate ?? "",
          relevanceScore: 0.6,
          retrievedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Search API may not be available on all plans — fail gracefully
      // so other providers can still contribute results. The ResearchEngine
      // already catches and logs provider errors at its level.
    }

    return results;
  }

  /**
   * Fetch a page using the Browserbase Fetch API.
   * This is a lightweight HTTP request — no browser session spins up.
   * Returns null if the content is insufficient (JS-rendered shell),
   * signalling the orchestrator to escalate to a browser session.
   */
  async fetch(source: ResearchSource): Promise<FetchedSource | null> {
    if (!hasApiKey()) return null;

    try {
      const bb = this.getClient();
      const data = await bb.fetchAPI.create({
        url: source.url,
        allowRedirects: true,
      });

      const content = typeof data.content === "string" ? data.content : JSON.stringify(data.content);
      const statusCode = data.statusCode;

      // Basic usability check — if content is too short or looks like a
      // JS shell, return null so the orchestrator can escalate to a
      // full browser session.
      if (content.length < 500) return null;
      if (/enable javascript/i.test(content) && content.length < 2000) return null;

      return {
        url: source.url,
        title: source.title ?? extractDomain(source.url),
        content: content.slice(0, 100000),
        contentType: "text/html",
        fetchedAt: new Date().toISOString(),
        statusCode,
      };
    } catch {
      return null;
    }
  }

  /**
   * Verify a fetched source. Checks content quality, accessibility,
   * and whether the URL appears to be an authoritative source.
   */
  async verify(source: FetchedSource): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const warnings: string[] = [];

    // HTTP status check
    checks.push({
      name: "accessible",
      passed: source.statusCode >= 200 && source.statusCode < 300,
      detail: `HTTP ${source.statusCode}`,
    });

    // Content presence
    checks.push({
      name: "has_content",
      passed: source.content.length > 200,
      detail: `${source.content.length} chars`,
    });

    // Official source indicator
    const domain = extractDomain(source.url);
    const isOfficial = /docs\.|developer\.|official/i.test(source.url) ||
      /\.(gov|edu|org|io|dev)$/i.test(domain);
    checks.push({
      name: "is_authoritative",
      passed: isOfficial,
      detail: isOfficial ? `${domain} appears authoritative` : `${domain} — authority unverified`,
    });

    // Freshness (based on content heuristics — can't parse exact dates reliably)
    const hasRecentDate = /20(2[4-9]|3[0-9])/.test(source.content.slice(0, 5000));
    checks.push({
      name: "appears_current",
      passed: hasRecentDate,
      detail: hasRecentDate ? "Recent date reference found" : "No recent date reference",
    });

    if (!isOfficial) warnings.push("Source is not clearly an official/authoritative domain");
    if (!hasRecentDate) warnings.push("Content may be outdated — no recent date references found");

    return {
      source,
      verified: checks.every((c) => c.passed),
      checks,
      warnings,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────

let _provider: BrowserbaseResearchProvider | null = null;

/**
 * Get the shared BrowserbaseResearchProvider instance.
 * Returns null if BROWSERBASE_API_KEY is not configured, so callers
 * can gracefully skip registration.
 */
export function getBrowserbaseProvider(): BrowserbaseResearchProvider | null {
  if (!hasApiKey()) return null;
  if (!_provider) _provider = new BrowserbaseResearchProvider();
  return _provider;
}
