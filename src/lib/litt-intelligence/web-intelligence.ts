/**
 * LiTT Web Intelligence — Unified Web Capability
 *
 * ONE internal capability that lets LiTT and Spark research, browse,
 * extract, verify, monitor, and interact with the web. Browserbase is
 * the underlying execution layer; this module is the intelligent
 * orchestrator that decides which path to take.
 *
 * Operations:
 *   search     — discover URLs for a query (Browserbase Search API)
 *   fetch      — lightweight content retrieval (Browserbase Fetch API)
 *   research   — full pipeline: search → fetch → escalate → extract → verify → save
 *   browse     — open a URL in a cloud browser (Stagehand)
 *   observe    — describe what's on a page (Stagehand observe)
 *   act        — perform an action on a page (Stagehand act)
 *   extract    — pull structured data from a page (Stagehand extract)
 *   verify     — cross-check a claim against sources
 *   compare    — extract from multiple URLs and compare
 *   monitor    — store a page-monitoring definition
 *   screenshot — capture a page screenshot
 *   pdf        — save a page as PDF
 *
 * Escalation strategy (cheapest first):
 *   1. Check existing project memory / cached sources
 *   2. Search (Browserbase Search API — no browser)
 *   3. Fetch (Browserbase Fetch API — no browser)
 *   4. Browser (Stagehand — full cloud browser session)
 *
 * Security: server-only. BROWSERBASE_API_KEY never exposed to client.
 */

import "server-only";
import { randomUUID } from "crypto";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { getSourceRegistry, type WebSource, type WebSourceType, type ConfidenceLevel } from "./source-registry";
import { getBrowserbaseProvider } from "./browserbase-provider";
import type { ResearchQuery, FetchedSource, VerificationResult } from "./types";
import { planResearchQuery } from "./research-engine";

// ─── Types ───────────────────────────────────────────────────────

export type WebIntelligenceOperation =
  | "search"
  | "fetch"
  | "research"
  | "browse"
  | "observe"
  | "act"
  | "extract"
  | "verify"
  | "compare"
  | "monitor"
  | "screenshot"
  | "pdf";

export interface WebIntelligenceRequest {
  operation: WebIntelligenceOperation;
  ownerId: string;
  projectId?: string;
  conversationId?: string;

  // search / research
  query?: string;
  maxResults?: number;

  // fetch / browse / observe / act / extract / screenshot / pdf / monitor
  url?: string;

  // act
  action?: string;

  // extract / observe
  instruction?: string;
  schema?: Record<string, unknown>;

  // compare
  urls?: string[];

  // verify
  claim?: string;
  sourceIds?: string[];

  // monitor
  monitorLabel?: string;
  extractionTarget?: string;
  checkIntervalSeconds?: number;

  // options
  forceBrowser?: boolean;
  useProxies?: boolean;
  model?: string;
}

export interface WebIntelligenceResult {
  operation: WebIntelligenceOperation;
  success: boolean;
  data?: unknown;
  sources?: WebSource[];
  sessionId?: string;
  liveViewUrl?: string;
  error?: string;
  /** Which execution path was taken (for cost/perf visibility) */
  path?: "cache" | "search" | "fetch" | "browser";
  durationMs?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function hasApiKey(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim());
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function classifyUrl(url: string): WebSourceType {
  const lower = url.toLowerCase();
  if (lower.includes("github.com")) return "official_repository";
  if (/docs\./.test(lower) || /documentation/.test(lower)) return "official_documentation";
  if (lower.includes("npmjs.com") || lower.includes("pypi.org")) return "package_registry";
  if (/reddit\.com|stackoverflow\.com|news\.ycombinator/.test(lower)) return "community_discussion";
  if (/arxiv\.org|scholar\.google|doi\.org|semanticscholar/.test(lower)) return "research_paper";
  if (/cnn\.com|bbc\.|reuters|nytimes|bloomberg/.test(lower)) return "news";
  if (/\.gov$/.test(lower)) return "official";
  return "independent_analysis";
}

function confidenceFromVerification(verification: VerificationResult | null): ConfidenceLevel {
  if (!verification) return "low";
  if (verification.verified) return "high";
  if (verification.checks.some((c) => c.passed)) return "medium";
  return "low";
}

// ─── Browser session management ──────────────────────────────────

/**
 * Create a Stagehand session connected to a Browserbase cloud browser.
 * Returns the stagehand instance and the live-view URL for debugging.
 */
async function createBrowserSession(
  options?: { useProxies?: boolean; model?: string },
): Promise<{ stagehand: Stagehand; sessionId?: string; liveViewUrl?: string }> {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    model: options?.model ?? "gemini-2.5-flash",
    browserbaseSessionCreateParams: {
      // Proxies are a paid feature — only enable when explicitly requested
      proxies: options?.useProxies ?? false,
      browserSettings: {
        blockAds: true,
      },
    },
  });

  await stagehand.init();

  const sessionId = stagehand.browserbaseSessionID;
  const liveViewUrl = sessionId
    ? `https://www.browserbase.com/sessions/${sessionId}`
    : undefined;

  return { stagehand, sessionId, liveViewUrl };
}

// ─── Source persistence ──────────────────────────────────────────

/**
 * Convert a fetch result to a WebSource and save it to the registry.
 */
async function persistFetchedSource(
  ownerId: string,
  projectId: string | undefined,
  url: string,
  fetched: FetchedSource,
  verification: VerificationResult | null,
  originOperation: string,
  sessionId?: string,
): Promise<WebSource | null> {
  const registry = getSourceRegistry();
  return registry.save({
    ownerId,
    projectId: projectId ?? null,
    url,
    title: fetched.title,
    domain: extractDomain(url),
    sourceType: classifyUrl(url),
    retrievedAt: fetched.fetchedAt,
    content: fetched.content.slice(0, 50000),
    excerpt: fetched.content.slice(0, 500),
    contentType: fetched.contentType,
    statusCode: fetched.statusCode,
    verified: verification?.verified ?? false,
    verificationChecks: verification?.checks,
    verificationWarnings: verification?.warnings,
    confidence: confidenceFromVerification(verification),
    browserbaseSessionId: sessionId,
    originOperation,
  });
}

// ─── Operations ──────────────────────────────────────────────────

/**
 * SEARCH — discover URLs for a query using the Browserbase Search API.
 * No browser session is created.
 */
async function opSearch(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.query) return { operation: "search", success: false, error: "query is required" };

  const provider = getBrowserbaseProvider();
  if (!provider) return { operation: "search", success: false, error: "BROWSERBASE_API_KEY not configured" };

  const researchQuery: ResearchQuery = {
    id: `rq-${randomUUID()}`,
    text: req.query,
    subqueries: [req.query],
    intent: "search",
    constraints: [],
  };

  const results = await provider.search(researchQuery);

  return {
    operation: "search",
    success: true,
    data: results,
    path: "search",
    durationMs: Date.now() - start,
  };
}

/**
 * FETCH — lightweight content retrieval via Browserbase Fetch API.
 * Falls back to browser if the page is JS-rendered and forceBrowser is set.
 */
async function opFetch(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url) return { operation: "fetch", success: false, error: "url is required" };

  // Check cache first — return existing source if fresh (< 1 hour)
  if (!req.forceBrowser) {
    const registry = getSourceRegistry();
    const cached = await registry.findByUrl(req.url, req.ownerId, req.projectId);
    if (cached && cached.retrievedAt) {
      const ageMs = Date.now() - new Date(cached.retrievedAt).getTime();
      if (ageMs < 60 * 60 * 1000 && cached.content) {
        return {
          operation: "fetch",
          success: true,
          data: cached,
          sources: [cached],
          path: "cache",
          durationMs: Date.now() - start,
        };
      }
    }
  }

  const provider = getBrowserbaseProvider();
  if (!provider) return { operation: "fetch", success: false, error: "BROWSERBASE_API_KEY not configured" };

  const fetched = await provider.fetch({ url: req.url, sourceType: classifyUrl(req.url) });

  if (fetched) {
    const verification = await provider.verify(fetched);
    const source = await persistFetchedSource(
      req.ownerId, req.projectId, req.url, fetched, verification, "fetch",
    );

    return {
      operation: "fetch",
      success: true,
      data: { content: fetched.content.slice(0, 5000), title: fetched.title, statusCode: fetched.statusCode },
      sources: source ? [source] : [],
      path: "fetch",
      durationMs: Date.now() - start,
    };
  }

  // Fetch returned insufficient content — escalate to browser if requested
  if (req.forceBrowser) {
    return opBrowse(req);
  }

  return {
    operation: "fetch",
    success: false,
    error: "Fetch returned insufficient content. Set forceBrowser: true to escalate to a cloud browser session.",
    path: "fetch",
    durationMs: Date.now() - start,
  };
}

/**
 * RESEARCH — full pipeline: search → fetch → escalate → extract → verify → save.
 * This is the main entry point for "research the best X" requests.
 */
async function opResearch(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.query) return { operation: "research", success: false, error: "query is required" };

  const provider = getBrowserbaseProvider();
  if (!provider) return { operation: "research", success: false, error: "BROWSERBASE_API_KEY not configured" };

  const maxResults = req.maxResults ?? 5;
  const researchQuery = planResearchQuery(req.query);

  // Step 1: Search
  const searchResults = await provider.search(researchQuery);
  if (searchResults.length === 0) {
    return {
      operation: "research",
      success: false,
      error: "No results found for this query",
      path: "search",
      durationMs: Date.now() - start,
    };
  }

  // Step 2: Fetch top results
  const sources: WebSource[] = [];
  const topResults = searchResults.slice(0, maxResults);

  for (const result of topResults) {
    const fetched = await provider.fetch({ url: result.url, sourceType: result.sourceType, title: result.title });

    if (fetched) {
      // Step 3: Verify
      const verification = await provider.verify(fetched);
      const source = await persistFetchedSource(
        req.ownerId, req.projectId, result.url, fetched, verification, "research",
      );
      if (source) sources.push(source);
    }
    // If fetch fails (JS-rendered), we skip — browser escalation for
    // research is handled per-source when the user requests it via
    // the browse/extract operations on a specific URL.
  }

  // Step 4: Build summary with citations
  const verified = sources.filter((s) => s.verified);
  const unverified = sources.filter((s) => !s.verified);

  const summary = {
    query: req.query,
    totalFound: searchResults.length,
    fetched: sources.length,
    verified: verified.length,
    unverified: unverified.length,
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      domain: s.domain,
      sourceType: s.sourceType,
      confidence: s.confidence,
      verified: s.verified,
      excerpt: s.excerpt?.slice(0, 200),
    })),
  };

  return {
    operation: "research",
    success: true,
    data: summary,
    sources,
    path: "search",
    durationMs: Date.now() - start,
  };
}

/**
 * BROWSE — open a URL in a cloud browser session (Stagehand).
 * Returns the live-view URL for debugging.
 */
async function opBrowse(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url) return { operation: "browse", success: false, error: "url is required" };
  if (!hasApiKey()) return { operation: "browse", success: false, error: "BROWSERBASE_API_KEY not configured" };

  let stagehand: Stagehand | null = null;
  try {
    const session = await createBrowserSession({ useProxies: req.useProxies, model: req.model });
    stagehand = session.stagehand;

    const page = stagehand.context.pages()[0];
    await page.goto(req.url, { waitUntil: "domcontentloaded" });
    const title = await page.title();

    // Get page content via evaluate (Stagehand Page wraps CDP, not Playwright)
    const content = await page.evaluate(() => document.documentElement.outerHTML);
    const registry = getSourceRegistry();
    const source = await registry.save({
      ownerId: req.ownerId,
      projectId: req.projectId ?? null,
      url: req.url,
      title,
      domain: extractDomain(req.url),
      sourceType: classifyUrl(req.url),
      retrievedAt: new Date().toISOString(),
      content: typeof content === "string" ? content.slice(0, 50000) : String(content).slice(0, 50000),
      excerpt: typeof content === "string" ? content.slice(0, 500) : String(content).slice(0, 500),
      browserbaseSessionId: session.sessionId,
      originOperation: "browse",
    });

    return {
      operation: "browse",
      success: true,
      data: { title, url: req.url },
      sources: source ? [source] : [],
      sessionId: session.sessionId,
      liveViewUrl: session.liveViewUrl,
      path: "browser",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      operation: "browse",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "browser",
      durationMs: Date.now() - start,
    };
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }
}

/**
 * OBSERVE — describe what's on a page using Stagehand's observe().
 */
async function opObserve(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url) return { operation: "observe", success: false, error: "url is required" };
  if (!hasApiKey()) return { operation: "observe", success: false, error: "BROWSERBASE_API_KEY not configured" };

  let stagehand: Stagehand | null = null;
  try {
    const session = await createBrowserSession({ useProxies: req.useProxies, model: req.model });
    stagehand = session.stagehand;

    const page = stagehand.context.pages()[0];
    await page.goto(req.url, { waitUntil: "domcontentloaded" });

    const observation = await stagehand.observe(
      req.instruction ?? "Describe the main elements and actions available on this page",
    );

    return {
      operation: "observe",
      success: true,
      data: observation,
      sessionId: session.sessionId,
      liveViewUrl: session.liveViewUrl,
      path: "browser",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      operation: "observe",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "browser",
      durationMs: Date.now() - start,
    };
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }
}

/**
 * ACT — perform an action on a page using Stagehand's act().
 */
async function opAct(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url || !req.action) {
    return { operation: "act", success: false, error: "url and action are required" };
  }
  if (!hasApiKey()) return { operation: "act", success: false, error: "BROWSERBASE_API_KEY not configured" };

  let stagehand: Stagehand | null = null;
  try {
    const session = await createBrowserSession({ useProxies: req.useProxies, model: req.model });
    stagehand = session.stagehand;

    const page = stagehand.context.pages()[0];
    await page.goto(req.url, { waitUntil: "domcontentloaded" });

    const result = await stagehand.act(req.action);

    // Capture the page state after the action
    const title = await page.title();
    const url = page.url();

    return {
      operation: "act",
      success: true,
      data: { action: req.action, result, pageTitle: title, pageUrl: url },
      sessionId: session.sessionId,
      liveViewUrl: session.liveViewUrl,
      path: "browser",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      operation: "act",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "browser",
      durationMs: Date.now() - start,
    };
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }
}

/**
 * EXTRACT — pull structured data from a page using Stagehand's extract().
 */
async function opExtract(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url) return { operation: "extract", success: false, error: "url is required" };
  if (!hasApiKey()) return { operation: "extract", success: false, error: "BROWSERBASE_API_KEY not configured" };

  let stagehand: Stagehand | null = null;
  try {
    const session = await createBrowserSession({ useProxies: req.useProxies, model: req.model });
    stagehand = session.stagehand;

    const page = stagehand.context.pages()[0];
    await page.goto(req.url, { waitUntil: "domcontentloaded" });

    // Build a Zod schema from the provided schema, or use a default
    // generic schema that extracts the page title and main text content
    let schema: z.ZodTypeAny;
    if (req.schema) {
      schema = z.object(
        Object.fromEntries(
          Object.entries(req.schema).map(([key, value]) => {
            if (typeof value === "string" && value.includes("[]")) {
              return [key, z.array(z.string()).describe(value.replace("[]", ""))];
            }
            return [key, z.string().describe(String(value))];
          }),
        ),
      );
    } else {
      schema = z.object({
        title: z.string().describe("The page title"),
        content: z.string().describe("The main text content of the page"),
        items: z.array(z.object({
          name: z.string(),
          value: z.string().optional(),
        })).optional().describe("Key items or data points on the page"),
      });
    }

    const instruction = req.instruction ?? "Extract the main content and key data from this page";
    const extracted = await stagehand.extract(instruction, schema);

    // Save the source with extracted data
    const title = await page.title();
    const registry = getSourceRegistry();
    const source = await registry.save({
      ownerId: req.ownerId,
      projectId: req.projectId ?? null,
      url: req.url,
      title,
      domain: extractDomain(req.url),
      sourceType: classifyUrl(req.url),
      retrievedAt: new Date().toISOString(),
      excerpt: JSON.stringify(extracted).slice(0, 500),
      metadata: { extracted: true, instruction },
      browserbaseSessionId: session.sessionId,
      originOperation: "extract",
    });

    return {
      operation: "extract",
      success: true,
      data: extracted,
      sources: source ? [source] : [],
      sessionId: session.sessionId,
      liveViewUrl: session.liveViewUrl,
      path: "browser",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      operation: "extract",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "browser",
      durationMs: Date.now() - start,
    };
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }
}

/**
 * VERIFY — cross-check a claim against saved sources.
 */
async function opVerify(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.claim) return { operation: "verify", success: false, error: "claim is required" };

  const registry = getSourceRegistry();
  const sources: WebSource[] = [];

  if (req.sourceIds && req.sourceIds.length > 0) {
    for (const id of req.sourceIds) {
      const source = await registry.getById(id);
      if (source) sources.push(source);
    }
  } else if (req.projectId) {
    const projectSources = await registry.listForProject(req.ownerId, req.projectId, { limit: 10 });
    sources.push(...projectSources);
  }

  // Simple text-match verification: check if the claim appears in source content
  const claimLower = req.claim.toLowerCase();
  const checks = sources.map((source) => {
    const content = (source.content ?? "").toLowerCase();
    const excerpt = (source.excerpt ?? "").toLowerCase();
    const matches = content.includes(claimLower) || excerpt.includes(claimLower);
    return {
      sourceId: source.id,
      sourceTitle: source.title,
      sourceUrl: source.url,
      claimSupported: matches,
      confidence: source.confidence,
    };
  });

  const supported = checks.filter((c) => c.claimSupported);
  const verdict = supported.length > 0
    ? `Claim is supported by ${supported.length} of ${checks.length} sources`
    : checks.length > 0
      ? "Claim is not directly supported by any available source"
      : "No sources available to verify this claim";

  return {
    operation: "verify",
    success: true,
    data: { claim: req.claim, verdict, checks },
    sources,
    path: "cache",
    durationMs: Date.now() - start,
  };
}

/**
 * COMPARE — extract from multiple URLs and compare.
 */
async function opCompare(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.urls || req.urls.length < 2) {
    return { operation: "compare", success: false, error: "At least 2 URLs are required for comparison" };
  }

  // Fetch each URL (using the fast path first, browser fallback per-URL)
  const results: Array<{ url: string; source: WebSource | null; error?: string }> = [];

  for (const url of req.urls) {
    const fetchResult = await opFetch({
      operation: "fetch",
      ownerId: req.ownerId,
      projectId: req.projectId,
      url,
      forceBrowser: req.forceBrowser,
    });

    if (fetchResult.success && fetchResult.sources && fetchResult.sources.length > 0) {
      results.push({ url, source: fetchResult.sources[0] });
    } else {
      results.push({ url, source: null, error: fetchResult.error ?? "Fetch failed" });
    }
  }

  const successful = results.filter((r) => r.source !== null);

  return {
    operation: "compare",
    success: successful.length > 0,
    data: {
      totalRequested: req.urls.length,
      successful: successful.length,
      failed: results.length - successful.length,
      comparisons: results.map((r) => ({
        url: r.url,
        title: r.source?.title,
        domain: r.source?.domain,
        sourceType: r.source?.sourceType,
        confidence: r.source?.confidence,
        verified: r.source?.verified,
        excerpt: r.source?.excerpt?.slice(0, 300),
        error: r.error,
      })),
    },
    sources: successful.map((r) => r.source!),
    path: "fetch",
    durationMs: Date.now() - start,
  };
}

/**
 * MONITOR — store a page-monitoring definition for scheduled checks.
 */
async function opMonitor(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url) return { operation: "monitor", success: false, error: "url is required" };
  if (!req.extractionTarget) return { operation: "monitor", success: false, error: "extractionTarget is required" };

  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    const id = randomUUID();
    const { error } = await supabaseAdmin
      .from("web_monitors")
      .insert({
        id,
        owner_id: req.ownerId,
        project_id: req.projectId ?? null,
        url: req.url,
        label: req.monitorLabel ?? req.url,
        extraction_target: req.extractionTarget,
        extraction_schema: req.schema ?? {},
        check_interval_seconds: req.checkIntervalSeconds ?? 3600,
        enabled: true,
        notify_on_change: true,
      })
      .select()
      .single();

    if (error) {
      return { operation: "monitor", success: false, error: error.message, durationMs: Date.now() - start };
    }

    return {
      operation: "monitor",
      success: true,
      data: {
        monitorId: id,
        url: req.url,
        label: req.monitorLabel ?? req.url,
        extractionTarget: req.extractionTarget,
        checkIntervalSeconds: req.checkIntervalSeconds ?? 3600,
        message: "Monitor created. The page will be checked on the configured interval and you'll be notified of changes.",
      },
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      operation: "monitor",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * SCREENSHOT — capture a page screenshot via a cloud browser session.
 */
async function opScreenshot(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url) return { operation: "screenshot", success: false, error: "url is required" };
  if (!hasApiKey()) return { operation: "screenshot", success: false, error: "BROWSERBASE_API_KEY not configured" };

  let stagehand: Stagehand | null = null;
  try {
    const session = await createBrowserSession({ useProxies: req.useProxies, model: req.model });
    stagehand = session.stagehand;

    const page = stagehand.context.pages()[0];
    await page.goto(req.url, { waitUntil: "domcontentloaded" });
    const screenshot = await page.screenshot({ fullPage: true });
    const title = await page.title();

    // Upload to R2 if configured, otherwise return base64
    const r2 = process.env.R2_ACCOUNT_ID;
    let screenshotUrl: string | undefined;

    if (r2 && screenshot) {
      try {
        const { uploadBinaryAsset, getPublicAssetUrl } = await import("@/lib/r2");
        const filename = `${randomUUID()}.png`;
        await uploadBinaryAsset(req.ownerId, filename, screenshot, "image/png", "web-intelligence");
        screenshotUrl = getPublicAssetUrl(`web-intelligence/${filename}`);
      } catch {
        // R2 upload failed — return the screenshot as base64 data
      }
    }

    // Save source record
    const registry = getSourceRegistry();
    const source = await registry.save({
      ownerId: req.ownerId,
      projectId: req.projectId ?? null,
      url: req.url,
      title,
      domain: extractDomain(req.url),
      sourceType: classifyUrl(req.url),
      retrievedAt: new Date().toISOString(),
      screenshotUrl,
      browserbaseSessionId: session.sessionId,
      originOperation: "screenshot",
    });

    const data: Record<string, unknown> = { title, url: req.url };
    if (screenshotUrl) data.screenshotUrl = screenshotUrl;
    else if (screenshot) data.screenshotBase64 = `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`;

    return {
      operation: "screenshot",
      success: true,
      data,
      sources: source ? [source] : [],
      sessionId: session.sessionId,
      liveViewUrl: session.liveViewUrl,
      path: "browser",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      operation: "screenshot",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "browser",
      durationMs: Date.now() - start,
    };
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }
}

/**
 * PDF — save a page as PDF via a cloud browser session.
 */
async function opPdf(req: WebIntelligenceRequest): Promise<WebIntelligenceResult> {
  const start = Date.now();
  if (!req.url) return { operation: "pdf", success: false, error: "url is required" };
  if (!hasApiKey()) return { operation: "pdf", success: false, error: "BROWSERBASE_API_KEY not configured" };

  let stagehand: Stagehand | null = null;
  try {
    const session = await createBrowserSession({ useProxies: req.useProxies, model: req.model });
    stagehand = session.stagehand;

    const page = stagehand.context.pages()[0];
    await page.goto(req.url, { waitUntil: "domcontentloaded" });

    // Stagehand's Page wraps CDP, not Playwright — use CDP's Page.printToPDF
    const pdfResult = await page.sendCDP<{ data: string }>("Page.printToPDF", {
      format: "A4",
      printBackground: true,
    });
    const pdfBuffer = pdfResult?.data ? Buffer.from(pdfResult.data, "base64") : null;
    const title = await page.title();

    // Upload to R2 if configured
    const r2 = process.env.R2_ACCOUNT_ID;
    let fileUrl: string | undefined;

    if (r2 && pdfBuffer) {
      try {
        const { uploadBinaryAsset, getPublicAssetUrl } = await import("@/lib/r2");
        const filename = `${randomUUID()}.pdf`;
        await uploadBinaryAsset(req.ownerId, filename, pdfBuffer, "application/pdf", "web-intelligence");
        fileUrl = getPublicAssetUrl(`web-intelligence/${filename}`);
      } catch {
        // R2 upload failed
      }
    }

    const registry = getSourceRegistry();
    const source = await registry.save({
      ownerId: req.ownerId,
      projectId: req.projectId ?? null,
      url: req.url,
      title,
      domain: extractDomain(req.url),
      sourceType: classifyUrl(req.url),
      retrievedAt: new Date().toISOString(),
      fileUrl,
      browserbaseSessionId: session.sessionId,
      originOperation: "pdf",
    });

    const data: Record<string, unknown> = { title, url: req.url };
    if (fileUrl) data.pdfUrl = fileUrl;
    else if (pdfBuffer) data.pdfBase64 = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;

    return {
      operation: "pdf",
      success: true,
      data,
      sources: source ? [source] : [],
      sessionId: session.sessionId,
      liveViewUrl: session.liveViewUrl,
      path: "browser",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      operation: "pdf",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "browser",
      durationMs: Date.now() - start,
    };
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────

/**
 * Execute a Web Intelligence operation. This is the single entry point
 * that LiTT and Spark call. The operation field determines which path
 * is taken — callers don't need to know about Browserbase, Stagehand,
 * or the Fetch API.
 */
export async function executeWebIntelligence(
  req: WebIntelligenceRequest,
): Promise<WebIntelligenceResult> {
  try {
    switch (req.operation) {
      case "search": return opSearch(req);
      case "fetch": return opFetch(req);
      case "research": return opResearch(req);
      case "browse": return opBrowse(req);
      case "observe": return opObserve(req);
      case "act": return opAct(req);
      case "extract": return opExtract(req);
      case "verify": return opVerify(req);
      case "compare": return opCompare(req);
      case "monitor": return opMonitor(req);
      case "screenshot": return opScreenshot(req);
      case "pdf": return opPdf(req);
      default:
        return {
          operation: req.operation,
          success: false,
          error: `Unknown operation: ${req.operation}`,
        };
    }
  } catch (err) {
    return {
      operation: req.operation,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Intent detection ────────────────────────────────────────────

/**
 * Detect which Web Intelligence operation a user's message implies.
 * This lets LiTT route "research the best X" to the research operation,
 * "screenshot this page" to screenshot, etc. — without the user needing
 * to know the operation names.
 */
export function detectWebIntelligenceIntent(message: string): WebIntelligenceOperation | null {
  const lower = message.toLowerCase();

  // Monitor
  if (/(monitor|watch|alert me|notify me|track).*(page|site|price|change)/i.test(lower)) {
    return "monitor";
  }

  // Screenshot
  if (/screenshot|capture.*(page|site)|snap.*(page|site)/i.test(lower)) {
    return "screenshot";
  }

  // PDF
  if (/\bpdf\b|save.*(page|site).*as.*(pdf|document)|download.*(page|site)/i.test(lower)) {
    return "pdf";
  }

  // Act (form filling, clicking)
  if (/(fill|submit|complete|click|press).*(form|button|field|application|signup|register)/i.test(lower)) {
    return "act";
  }

  // Compare
  if (/compare.*(these|vs|versus|between|difference)/i.test(lower) || /\bvs\b/i.test(lower)) {
    return "compare";
  }

  // Verify
  if (/(verify|check if|is this (true|accurate|correct)|fact.?check)/i.test(lower)) {
    return "verify";
  }

  // Research (the most common — check after specific operations)
  if (/(research|find (out|the|information)|investigate|look up|what are the best|compare.*(options|products|tools))/i.test(lower)) {
    return "research";
  }

  // Extract
  if (/(extract|pull|get).*(data|info|information|price|title|content|spec)/i.test(lower)) {
    return "extract";
  }

  // Browse
  if (/(browse|open|visit|go to).*(http|url|page|site|link)/i.test(lower)) {
    return "browse";
  }

  // Search
  if (/(search|google|find).*(for|web|online|internet)/i.test(lower)) {
    return "search";
  }

  return null;
}
