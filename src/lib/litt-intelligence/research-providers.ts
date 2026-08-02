/**
 * Research Providers
 *
 * Initial provider implementations for the research engine.
 * Each provider implements the ResearchProvider interface.
 *
 * Providers are optional and behind interfaces — no hardwired vendor.
 * SearXNG and Firecrawl are optional and only enabled when configured.
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
import type { ResearchProvider } from "./research-engine";

// ─── GitHub Search Provider ─────────────────────────────────────

/**
 * Searches GitHub repositories and code using the GitHub REST API.
 * Requires GITHUB_TOKEN environment variable.
 */
export class GitHubSearchProvider implements ResearchProvider {
  name = "github";
  private token: string | undefined;

  constructor() {
    this.token = process.env.GITHUB_TOKEN;
  }

  async search(query: ResearchQuery): Promise<SearchResult[]> {
    if (!this.token) return [];

    const results: SearchResult[] = [];
    const searchTerm = query.subqueries[0] ?? query.text;

    try {
      // Search repositories
      const repoUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(searchTerm)}&sort=stars&order=desc&per_page=5`;
      const repoRes = await fetch(repoUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (repoRes.ok) {
        const data = await repoRes.json() as { items?: Array<{ full_name: string; html_url: string; description: string; stargazers_count: number; license?: { spdx_id: string } | null; updated_at: string }> };
        for (const repo of data.items ?? []) {
          results.push({
            id: `gh-${randomUUID()}`,
            title: repo.full_name,
            url: repo.html_url,
            sourceType: "official_repository",
            snippet: repo.description ?? "",
            relevanceScore: Math.min(repo.stargazers_count / 10000, 1),
            retrievedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error("[research:github] Search failed:", err instanceof Error ? err.message : String(err));
    }

    return results;
  }

  async fetch(source: ResearchSource): Promise<FetchedSource | null> {
    try {
      const res = await fetch(source.url, {
        headers: { Accept: "text/html" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;

      const content = await res.text();
      return {
        url: source.url,
        title: source.title ?? source.url,
        content: content.slice(0, 50000),
        contentType: res.headers.get("content-type") ?? "text/html",
        fetchedAt: new Date().toISOString(),
        statusCode: res.status,
      };
    } catch {
      return null;
    }
  }

  async verify(source: FetchedSource): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const warnings: string[] = [];

    // Check if it's a valid GitHub URL
    const isGitHub = source.url.includes("github.com");
    checks.push({
      name: "is_github",
      passed: isGitHub,
      detail: isGitHub ? "URL is a GitHub URL" : "URL is not a GitHub URL",
    });

    // Check if content is non-empty
    checks.push({
      name: "has_content",
      passed: source.content.length > 100,
      detail: `Content length: ${source.content.length}`,
    });

    // Check for README content
    const hasReadme = /<article[^>]*>/.test(source.content) || /README/i.test(source.content);
    checks.push({
      name: "has_readme",
      passed: hasReadme,
      detail: hasReadme ? "README content found" : "No README content detected",
    });

    if (!isGitHub) warnings.push("Source is not a GitHub URL");

    return {
      source,
      verified: checks.every((c) => c.passed),
      checks,
      warnings,
    };
  }
}

// ─── Web Search Provider ────────────────────────────────────────

/**
 * General web search provider. Uses a configurable search backend.
 * In production, this can be backed by SearXNG, Serper, or another
 * search API. Falls back to no results when no backend is configured.
 */
export class WebSearchProvider implements ResearchProvider {
  name = "web";
  private searchEndpoint: string | undefined;

  constructor() {
    // Optional: SearXNG or other metasearch endpoint
    this.searchEndpoint = process.env.SEARXNG_URL;
  }

  async search(query: ResearchQuery): Promise<SearchResult[]> {
    if (!this.searchEndpoint) return [];

    const results: SearchResult[] = [];

    try {
      const url = `${this.searchEndpoint}/search?q=${encodeURIComponent(query.text)}&format=json`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json() as { results?: Array<{ url: string; title: string; content: string; engine?: string }> };
        for (const item of data.results ?? []) {
          results.push({
            id: `web-${randomUUID()}`,
            title: item.title,
            url: item.url,
            sourceType: this.classifySourceType(item.url, item.engine),
            snippet: item.content ?? "",
            relevanceScore: 0.5,
            retrievedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error("[research:web] Search failed:", err instanceof Error ? err.message : String(err));
    }

    return results;
  }

  async fetch(source: ResearchSource): Promise<FetchedSource | null> {
    try {
      const res = await fetch(source.url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "LiTT-Research/1.0" },
      });
      if (!res.ok) return null;

      const content = await res.text();
      return {
        url: source.url,
        title: source.title ?? source.url,
        content: content.slice(0, 50000),
        contentType: res.headers.get("content-type") ?? "text/html",
        fetchedAt: new Date().toISOString(),
        statusCode: res.status,
      };
    } catch {
      return null;
    }
  }

  async verify(source: FetchedSource): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const warnings: string[] = [];

    checks.push({
      name: "accessible",
      passed: source.statusCode === 200,
      detail: `HTTP status: ${source.statusCode}`,
    });

    checks.push({
      name: "has_content",
      passed: source.content.length > 100,
      detail: `Content length: ${source.content.length}`,
    });

    // Check for official source indicators
    const isOfficial = /docs\./i.test(source.url) || /official/i.test(source.url);
    checks.push({
      name: "is_official",
      passed: isOfficial,
      detail: isOfficial ? "URL appears to be official documentation" : "URL is not clearly official",
    });

    if (!isOfficial) warnings.push("Source is not clearly official documentation");

    return {
      source,
      verified: checks.every((c) => c.passed),
      checks,
      warnings,
    };
  }

  private classifySourceType(url: string, engine?: string): string {
    if (/github\.com/i.test(url)) return "official_repository";
    if (/docs\./i.test(url) || /documentation/i.test(url)) return "official_documentation";
    if (/npmjs\.com/i.test(url) || /pypi\.org/i.test(url)) return "package_registry";
    if (/reddit\.com/i.test(url) || /stackoverflow\.com/i.test(url)) return "community_discussion";
    if (engine) return "independent_analysis";
    return "unknown";
  }
}

// ─── Package Registry Provider ──────────────────────────────────

/**
 * Searches npm and PyPI package registries for package metadata.
 */
export class PackageRegistryProvider implements ResearchProvider {
  name = "package_registry";

  async search(query: ResearchQuery): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchTerm = query.subqueries[0] ?? query.text;

    // Search npm
    try {
      const npmUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(searchTerm)}&size=5`;
      const npmRes = await fetch(npmUrl, {
        signal: AbortSignal.timeout(8000),
      });

      if (npmRes.ok) {
        const data = await npmRes.json() as { objects?: Array<{ package: { name: string; version: string; description: string; links: { npm: string }; date?: string } }> };
        for (const item of data.objects ?? []) {
          results.push({
            id: `npm-${randomUUID()}`,
            title: `${item.package.name}@${item.package.version}`,
            url: item.package.links.npm,
            sourceType: "package_registry",
            snippet: item.package.description ?? "",
            relevanceScore: 0.7,
            retrievedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error("[research:npm] Search failed:", err instanceof Error ? err.message : String(err));
    }

    return results;
  }

  async fetch(source: ResearchSource): Promise<FetchedSource | null> {
    try {
      // Fetch package metadata from npm
      if (source.url.includes("npmjs.com")) {
        const pkgName = source.url.split("/package/").pop();
        if (!pkgName) return null;

        const metaUrl = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;
        const res = await fetch(metaUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;

        const data = await res.text();
        return {
          url: source.url,
          title: source.title ?? pkgName,
          content: data.slice(0, 50000),
          contentType: "application/json",
          fetchedAt: new Date().toISOString(),
          statusCode: res.status,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async verify(source: FetchedSource): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const warnings: string[] = [];

    try {
      const data = JSON.parse(source.content) as {
        license?: string;
        deprecated?: string;
        time?: { modified?: string };
        versions?: Record<string, unknown>;
      };

      checks.push({
        name: "has_license",
        passed: !!data.license,
        detail: data.license ? `License: ${data.license}` : "No license specified",
      });

      checks.push({
        name: "not_deprecated",
        passed: !data.deprecated,
        detail: data.deprecated ? `Deprecated: ${data.deprecated}` : "Not deprecated",
      });

      const lastModified = data.time?.modified;
      const isRecent = lastModified
        ? Date.now() - Date.parse(lastModified) < 365 * 24 * 60 * 60 * 1000
        : false;
      checks.push({
        name: "recently_updated",
        passed: isRecent,
        detail: lastModified ? `Last modified: ${lastModified}` : "No modification date",
      });

      if (!data.license) warnings.push("Package has no license — legal use unclear");
      if (data.deprecated) warnings.push(`Package is deprecated: ${data.deprecated}`);
      if (!isRecent) warnings.push("Package has not been updated in over a year");
    } catch {
      checks.push({
        name: "valid_json",
        passed: false,
        detail: "Could not parse package metadata",
      });
    }

    return {
      source,
      verified: checks.every((c) => c.passed),
      checks,
      warnings,
    };
  }
}

// ─── OpenAPI Directory Provider ─────────────────────────────────

/**
 * Searches APIs.guru for machine-readable OpenAPI definitions.
 * Treated as a discovery catalog, not proof that an API is safe.
 */
export class OpenAPIDirectoryProvider implements ResearchProvider {
  name = "openapi_directory";

  async search(query: ResearchQuery): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchTerm = query.text.toLowerCase();

    try {
      const res = await fetch("https://api.apis.guru/v2/list.json", {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json() as Record<string, {
          versions: Record<string, {
            info?: { title?: string; description?: string };
            swaggerUrl?: string;
            openapiUrl?: string;
          }>;
        }>;

        for (const [apiName, apiData] of Object.entries(data)) {
          const latestVersion = Object.values(apiData.versions ?? {})[0];
          if (!latestVersion) continue;

          const title = latestVersion.info?.title ?? apiName;
          const description = latestVersion.info?.description ?? "";

          // Match by search term in title or API name
          if (
            title.toLowerCase().includes(searchTerm) ||
            apiName.toLowerCase().includes(searchTerm) ||
            description.toLowerCase().includes(searchTerm)
          ) {
            const specUrl = latestVersion.openapiUrl ?? latestVersion.swaggerUrl;
            if (specUrl) {
              results.push({
                id: `openapi-${randomUUID()}`,
                title,
                url: specUrl,
                sourceType: "official_api_spec",
                snippet: description.slice(0, 200),
                relevanceScore: 0.6,
                retrievedAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("[research:openapi] Search failed:", err instanceof Error ? err.message : String(err));
    }

    return results;
  }

  async fetch(source: ResearchSource): Promise<FetchedSource | null> {
    try {
      const res = await fetch(source.url, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;

      const content = await res.text();
      return {
        url: source.url,
        title: source.title ?? source.url,
        content: content.slice(0, 50000),
        contentType: res.headers.get("content-type") ?? "application/json",
        fetchedAt: new Date().toISOString(),
        statusCode: res.status,
      };
    } catch {
      return null;
    }
  }

  async verify(source: FetchedSource): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const warnings: string[] = [];

    try {
      const data = JSON.parse(source.content) as {
        openapi?: string;
        swagger?: string;
        info?: { title?: string; version?: string };
        paths?: Record<string, unknown>;
        security?: unknown;
      };

      checks.push({
        name: "valid_openapi",
        passed: !!data.openapi || !!data.swagger,
        detail: data.openapi ? `OpenAPI ${data.openapi}` : data.swagger ? `Swagger ${data.swagger}` : "Not an OpenAPI spec",
      });

      checks.push({
        name: "has_paths",
        passed: !!data.paths && Object.keys(data.paths).length > 0,
        detail: `Paths: ${data.paths ? Object.keys(data.paths).length : 0}`,
      });

      checks.push({
        name: "has_info",
        passed: !!data.info?.title,
        detail: data.info?.title ? `Title: ${data.info.title}` : "No title",
      });

      if (data.security) warnings.push("API requires authentication — review security scheme before use");
    } catch {
      checks.push({
        name: "valid_json",
        passed: false,
        detail: "Could not parse OpenAPI specification",
      });
    }

    warnings.push("APIs.guru is a discovery catalog — verify safety and appropriateness independently");

    return {
      source,
      verified: checks.every((c) => c.passed),
      checks,
      warnings,
    };
  }
}
