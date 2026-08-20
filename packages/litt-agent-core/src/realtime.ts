/**
 * Realtime internet capability — shared across all LiTT surfaces.
 *
 * LiTT is the brain; the ToolRegistry is capability. The same logical
 * realtime capability (web.search, web.fetch, weather.forecast) must be
 * available regardless of whether LiTT is driven from the CLI cockpit,
 * web Studio, voice, or mobile. This module is the ONE implementation of
 * that capability — surfaces adapt it into their own registries but never
 * reimplement the network logic or the SSRF defense.
 *
 * What this module provides:
 *   - SSRF-safe HTTP client (`safeFetch`) — the single hardened boundary
 *     for all outbound external-network reads.
 *   - `weatherForecast` — real current U.S. weather via the National
 *     Weather Service (no API key, no model invention).
 *   - `webSearch` — real web search via DuckDuckGo Instant Answers
 *     (no API key). Truthful when empty.
 *   - Tool definitions + handlers + metadata that merge into the default
 *     `ToolRegistry`, so every surface using `@litt/agent-core` gets them.
 *
 * Security model (PHASE 3):
 *   - `web.fetch` is the only tool that accepts a caller-supplied URL, so
 *     it is the SSRF boundary. `weatherForecast` and `webSearch` call only
 *     hardcoded, known-safe public endpoints (zippopotam.us,
 *     api.weather.gov, api.duckduckgo.com) — they never fetch a
 *     user-supplied URL, so they are not SSRF-exposed.
 *   - `safeFetch` blocks: non-http(s) schemes, localhost, link-local,
 *     RFC1918 private ranges, unique-local IPv6, cloud metadata endpoints,
 *     and hostnames that DNS-resolve to any of those. Redirects are
 *     followed manually and re-validated at every hop. Timeouts,
 *     response-size limits, and redirect limits are enforced.
 *
 * No React, Next.js, Clerk, Supabase, or browser globals. Node >= 22
 * (global fetch, AbortController, node:dns/promises).
 */

import * as dnsPromises from "node:dns/promises";
import type {
  ToolDefinition,
  ToolHandler,
  ToolEntry,
  ToolMetadata,
  ToolResult,
} from "./types.js";

// ─── SSRF Defense ──────────────────────────────────────────────────

/** Cloud metadata + link-local endpoints that must never be reached. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal", // GCP
  "169.254.169.254", // AWS / Azure / GCP metadata (also caught by IP check)
  "metadata.azure.com", // Azure
]);

/** Maximum number of HTTP redirects to follow. */
const MAX_REDIRECTS = 5;

/** Default per-request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum response body size (bytes). */
const MAX_RESPONSE_BYTES = 512 * 1024;

export interface SafeFetchOptions {
  /** Request timeout in ms (default 10s). */
  timeoutMs?: number;
  /** Max redirects (default 5). */
  maxRedirects?: number;
  /** Max response body bytes (default 512KB). */
  maxBytes?: number;
  /** Optional extra headers (e.g. User-Agent for NWS). */
  headers?: Record<string, string>;
  /** Acceptable content types; if set, response must match one. */
  acceptContentTypes?: string[];
  /** Injection seam for the DNS resolver (tests/surfaces may override). */
  dnsResolver?: DnsResolver;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  content: string;
  bytes: number;
  truncated: boolean;
}

/**
 * True if an IPv4 or IPv6 address is private / loopback / link-local /
 * unspecified / cloud-metadata. Used by both the literal-IP check and the
 * DNS-resolution check.
 */
export function isPrivateIp(ip: string): boolean {
  // ─── IPv6 ───
  // Normalize by stripping the zone id (%eth0) and lowercasing.
  const v6 = ip.split("%")[0].toLowerCase();
  if (v6.includes(":")) {
    if (v6 === "::1") return true; // loopback
    if (v6 === "::" || v6 === "::ffff:0.0.0.0") return true; // unspecified
    if (v6.startsWith("fe80:")) return true; // link-local
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique local fc00::/7
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract and re-check the v4 part.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpV4(mapped[1]);
    return false;
  }
  return isPrivateIpV4(ip);
}

function isPrivateIpV4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 0) return true; // 0.0.0.0/8 (unspecified / "this network")
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  return false;
}

export interface UrlSafetyViolation {
  safe: boolean;
  reason: string;
}

/**
 * Validate a URL's scheme + host WITHOUT DNS resolution. Catches the
 * cheap, deterministic SSRF cases. Use `assertPublicHostname` for the
 * DNS-resolution check; `safeFetch` runs both.
 */
export function assertSafeUrl(url: string): UrlSafetyViolation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: `Invalid URL: ${url}` };
  }

  // Scheme: only http/https. file://, ftp://, gopher://, etc. are blocked.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `Blocked scheme: ${parsed.protocol}` };
  }

  // WHATWG URL serializes IPv6 hosts WITH brackets (e.g. "[::1]"); strip
  // them so isIpLiteral/isPrivateIp see the bare address.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Blocked hostnames (localhost, cloud metadata names).
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { safe: false, reason: `Blocked hostname: ${host}` };
  }

  // *.localhost
  if (host.endsWith(".localhost")) {
    return { safe: false, reason: `Blocked hostname: ${host}` };
  }

  // If the host is an IP literal, check it directly.
  if (isIpLiteral(host)) {
    if (isPrivateIp(host)) {
      return { safe: false, reason: `Blocked private/internal IP: ${host}` };
    }
  }

  // No userinfo (http://user:pass@host) — strip credentials to avoid
  // confusing downstream parsers / log injection.
  if (parsed.username || parsed.password) {
    return { safe: false, reason: "URL userinfo (credentials) is not allowed" };
  }

  return { safe: true, reason: "" };
}

/** True if `s` is a bare IPv4 or IPv6 literal (not a hostname). */
function isIpLiteral(s: string): boolean {
  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return true;
  // IPv6 (contains a colon, no brackets after normalization)
  if (s.includes(":")) return true;
  return false;
}

/**
 * DNS-resolve `hostname` and reject if ANY resolved address is private.
 * This catches hostnames that resolve to internal/metadata IPs (a common
 * SSRF vector). Note: this is a single-resolution check and does not
 * defend against DNS-rebinding-to-private after a public first resolution;
 * that is an accepted, documented limitation for this read-only client.
 */
/** A pluggable DNS resolver — defaults to node:dns/promises.lookup. */
export type DnsResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** Default resolver: real DNS via node:dns/promises (verbatim A+AAAA). */
export const defaultDnsResolver: DnsResolver = (hostname) =>
  dnsPromises.lookup(hostname, { all: true, verbatim: true });

/**
 * DNS-resolve `hostname` and reject if ANY resolved address is private.
 * This catches hostnames that resolve to internal/metadata IPs (a common
 * SSRF vector). Note: this is a single-resolution check and does not
 * defend against DNS-rebinding-to-private after a public first resolution;
 * that is an accepted, documented limitation for this read-only client.
 *
 * `resolver` is an injection seam — surfaces may pass a cached/custom
 * resolver, and tests pass a fake to avoid real network DNS.
 */
export async function assertPublicHostname(
  hostname: string,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<UrlSafetyViolation> {
  const host = hostname.toLowerCase();
  // IP literals are already checked by assertSafeUrl; nothing to resolve.
  if (isIpLiteral(host)) {
    return isPrivateIp(host)
      ? { safe: false, reason: `Blocked private/internal IP: ${host}` }
      : { safe: true, reason: "" };
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await resolver(host);
  } catch {
    return { safe: false, reason: `DNS resolution failed for ${host}` };
  }
  if (records.length === 0) {
    return { safe: false, reason: `No DNS records for ${host}` };
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      return { safe: false, reason: `${host} resolves to private/internal IP ${r.address}` };
    }
  }
  return { safe: true, reason: "" };
}

/**
 * SSRF-safe HTTP GET. The single hardened boundary for outbound external
 * reads. Used by `web.fetch` and (internally) by the weather/search
 * helpers for their hardcoded endpoints.
 *
 * Enforces: scheme allowlist, private-IP blocking (literal + DNS),
 * redirect re-validation at every hop, timeout, response-size limit.
 */
export async function safeFetch(
  url: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  const resolver = opts.dnsResolver ?? defaultDnsResolver;

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // 1. Static URL safety (scheme, localhost, IP-literal).
    const staticCheck = assertSafeUrl(currentUrl);
    if (!staticCheck.safe) {
      throw new SafeFetchError(staticCheck.reason, "blocked");
    }
    // 2. DNS resolution check (hostname → public IPs only).
    const parsed = new URL(currentUrl);
    const dnsCheck = await assertPublicHostname(parsed.hostname, resolver);
    if (!dnsCheck.safe) {
      throw new SafeFetchError(dnsCheck.reason, "blocked");
    }

    // 3. Fetch with timeout + size cap.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual", // we handle redirects ourselves to re-validate
        signal: controller.signal,
        headers: { "Accept": "*/*", ...(opts.headers ?? {}) },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new SafeFetchError(`Request timed out after ${timeoutMs}ms`, "timeout");
      }
      throw new SafeFetchError(
        `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        "network",
      );
    }
    clearTimeout(timer);

    // 4. Redirect handling — re-validate the Location through the full
    //    SSRF pipeline (static + DNS) on the next loop iteration.
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeFetchError(`Redirect ${status} without Location header`, "network");
      }
      currentUrl = new URL(location, currentUrl).toString(); // resolve relative
      if (hop === maxRedirects) {
        throw new SafeFetchError(`Exceeded max redirects (${maxRedirects})`, "network");
      }
      continue;
    }

    // 5. Content-type check (optional).
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    if (opts.acceptContentTypes && opts.acceptContentTypes.length > 0) {
      if (!opts.acceptContentTypes.some((ct) => contentType.toLowerCase().startsWith(ct.toLowerCase()))) {
        throw new SafeFetchError(`Unexpected content-type: ${contentType}`, "network");
      }
    }

    // 6. Read body with a hard size cap.
    if (!response.body) {
      return {
        url: currentUrl,
        status,
        ok: response.ok,
        contentType,
        content: "",
        bytes: 0,
        truncated: false,
      };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            truncated = true;
            chunks.push(value.subarray(0, maxBytes - (total - value.byteLength)));
            break;
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      throw new SafeFetchError(
        `Body read failed: ${err instanceof Error ? err.message : String(err)}`,
        "network",
      );
    } finally {
      reader.releaseLock?.();
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return {
      url: currentUrl,
      status,
      ok: response.ok,
      contentType,
      content: buf.toString("utf8"),
      bytes: buf.byteLength,
      truncated,
    };
  }
  // Unreachable: the loop returns on a non-redirect response and throws
  // on too many redirects. Keep a defensive fallback.
  throw new SafeFetchError("Exceeded max redirects", "network");
}

/** Categorised fetch error so callers can distinguish SSRF blocks. */
export class SafeFetchError extends Error {
  readonly kind: "blocked" | "timeout" | "network";
  constructor(message: string, kind: "blocked" | "timeout" | "network") {
    super(message);
    this.name = "SafeFetchError";
    this.kind = kind;
  }
}

// ─── Weather (NWS) ─────────────────────────────────────────────────

/** A single NWS forecast period, trimmed to the fields LiTT surfaces. */
export interface ForecastPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number | null;
  temperatureUnit: string | null;
  windSpeed: string | null;
  windDirection: string | null;
  shortForecast: string | null;
  detailedForecast: string | null;
  /** Probability of precipitation (0-100), or null if unavailable. */
  probabilityOfPrecipitation: number | null;
}

export interface WeatherForecastResult {
  location: {
    zip: string;
    place: string;
    state: string;
    latitude: number;
    longitude: number;
  };
  /** ISO timestamp of the forecast update from NWS. */
  generatedAt: string | null;
  periods: ForecastPeriod[];
  source: {
    provider: string;
    forecastUrl: string;
  };
}

interface ZippopotamResponse {
  "post code": string;
  places: Array<{
    latitude: string;
    longitude: string;
    "place name": string;
    "state abbreviation": string;
  }>;
}

interface NwsPointsResponse {
  properties: {
    forecast: string;
    relativeLocation?: {
      properties: { city: string; state: string };
    };
  };
}

interface NwsForecastResponse {
  updated: string;
  properties: {
    periods: Array<{
      number: number;
      name: string;
      startTime: string;
      endTime: string;
      isDaytime: boolean;
      temperature: number;
      temperatureUnit: string;
      windSpeed: string;
      windDirection: string;
      shortForecast: string;
      detailedForecast: string;
      probabilityOfPrecipitation?: { value: number | null };
    }>;
  };
}

const NWS_USER_AGENT = "LiTT-Agent-Core/1.0 (litlabs-realtime)";

/**
 * Fetch a real U.S. weather forecast for a 5-digit ZIP code via the
 * National Weather Service. No API key. No model invention — every field
 * comes from NWS structured data, and missing fields stay null rather
 * than being guessed.
 *
 * Flow: ZIP → geocode (zippopotam.us) → NWS /points → NWS /forecast.
 */
export async function weatherForecast(
  zip: string,
  opts: { dnsResolver?: DnsResolver } = {},
): Promise<WeatherForecastResult> {
  const clean = String(zip).trim();
  if (!/^\d{5}$/.test(clean)) {
    throw new SafeFetchError(
      `Invalid U.S. ZIP code: "${zip}". Expected 5 digits.`,
      "blocked",
    );
  }

  // 1. Geocode ZIP → lat/lon + place name (free, no key).
  const geoRes = await safeFetch(`https://api.zippopotam.us/us/${clean}`, {
    timeoutMs: 8_000,
    acceptContentTypes: ["application/json"],
    dnsResolver: opts.dnsResolver,
  });
  if (!geoRes.ok || !geoRes.content) {
    throw new SafeFetchError(
      `Could not geocode ZIP ${clean} (zippopotam status ${geoRes.status})`,
      "network",
    );
  }
  let geo: ZippopotamResponse;
  try {
    geo = JSON.parse(geoRes.content) as ZippopotamResponse;
  } catch {
    throw new SafeFetchError("Malformed geocoding response", "network");
  }
  const place = geo.places?.[0];
  if (!place) {
    throw new SafeFetchError(`No location found for ZIP ${clean}`, "network");
  }
  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new SafeFetchError("Geocoding returned non-numeric coordinates", "network");
  }

  // 2. NWS /points/{lat},{lon} → forecast URL.
  const pointsRes = await safeFetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { timeoutMs: 8_000, headers: { "User-Agent": NWS_USER_AGENT }, acceptContentTypes: ["application/geo+json", "application/json"], dnsResolver: opts.dnsResolver },
  );
  if (!pointsRes.ok || !pointsRes.content) {
    throw new SafeFetchError(
      `NWS /points lookup failed (status ${pointsRes.status})`,
      "network",
    );
  }
  let points: NwsPointsResponse;
  try {
    points = JSON.parse(pointsRes.content) as NwsPointsResponse;
  } catch {
    throw new SafeFetchError("Malformed NWS /points response", "network");
  }
  const forecastUrl = points.properties?.forecast;
  if (!forecastUrl || typeof forecastUrl !== "string") {
    throw new SafeFetchError("NWS /points did not return a forecast URL", "network");
  }

  // 3. NWS forecast → periods.
  const fcRes = await safeFetch(forecastUrl, {
    timeoutMs: 10_000,
    headers: { "User-Agent": NWS_USER_AGENT },
    acceptContentTypes: ["application/geo+json", "application/json"],
    dnsResolver: opts.dnsResolver,
  });
  if (!fcRes.ok || !fcRes.content) {
    throw new SafeFetchError(
      `NWS forecast fetch failed (status ${fcRes.status})`,
      "network",
    );
  }
  let fc: NwsForecastResponse;
  try {
    fc = JSON.parse(fcRes.content) as NwsForecastResponse;
  } catch {
    throw new SafeFetchError("Malformed NWS forecast response", "network");
  }
  const rawPeriods = fc.properties?.periods ?? [];
  if (rawPeriods.length === 0) {
    throw new SafeFetchError("NWS forecast returned no periods", "network");
  }

  const periods: ForecastPeriod[] = rawPeriods.slice(0, 6).map((p) => ({
    number: p.number,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    isDaytime: p.isDaytime,
    temperature: p.temperature ?? null,
    temperatureUnit: p.temperatureUnit ?? null,
    windSpeed: p.windSpeed ?? null,
    windDirection: p.windDirection ?? null,
    shortForecast: p.shortForecast ?? null,
    detailedForecast: p.detailedForecast ?? null,
    probabilityOfPrecipitation: p.probabilityOfPrecipitation?.value ?? null,
  }));

  return {
    location: {
      zip: clean,
      place: place["place name"],
      state: place["state abbreviation"],
      latitude: lat,
      longitude: lon,
    },
    generatedAt: fc.updated ?? null,
    periods,
    source: {
      provider: "National Weather Service",
      forecastUrl,
    },
  };
}

// ─── Web Search (DuckDuckGo Instant Answers) ───────────────────────

export interface WebSearchResult {
  query: string;
  /** Direct answer string, if DuckDuckGo returned one. */
  answer: string | null;
  /** Abstract summary + source URL, if available. */
  abstract: string | null;
  abstractSource: string | null;
  abstractUrl: string | null;
  /** Related topics (capped). */
  relatedTopics: Array<{ text: string; url?: string }>;
  /** True when no instant answer was found (truthful empty state). */
  empty: boolean;
}

interface DuckDuckGoResponse {
  Abstract: string;
  AbstractText: string;
  AbstractSource: string;
  AbstractURL: string;
  Answer: string;
  AnswerType: string;
  Definition: string;
  RelatedTopics: Array<
    | { Text: string; FirstURL?: string }
    | { Topics?: Array<{ Text: string; FirstURL?: string }> }
  >;
}

/**
 * Real web search via the DuckDuckGo Instant Answer API (no API key).
 * Returns a truthful empty result when no instant answer exists — the
 * model must not invent results.
 */
export async function webSearch(
  query: string,
  opts: { dnsResolver?: DnsResolver } = {},
): Promise<WebSearchResult> {
  const q = String(query ?? "").trim();
  if (!q) {
    throw new SafeFetchError("Missing required input: query", "blocked");
  }
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  const res = await safeFetch(url, {
    timeoutMs: 12_000,
    acceptContentTypes: ["application/json"],
    dnsResolver: opts.dnsResolver,
  });
  if (!res.ok || !res.content) {
    throw new SafeFetchError(`Web search failed (status ${res.status})`, "network");
  }
  let ddg: DuckDuckGoResponse;
  try {
    ddg = JSON.parse(res.content) as DuckDuckGoResponse;
  } catch {
    throw new SafeFetchError("Malformed search response", "network");
  }

  const relatedTopics: Array<{ text: string; url?: string }> = [];
  for (const rt of ddg.RelatedTopics ?? []) {
    if (typeof rt === "object" && "Text" in rt && typeof rt.Text === "string") {
      relatedTopics.push({ text: rt.Text, url: rt.FirstURL });
    } else if (typeof rt === "object" && "Topics" in rt && Array.isArray(rt.Topics)) {
      for (const sub of rt.Topics) {
        if (sub && typeof sub.Text === "string") {
          relatedTopics.push({ text: sub.Text, url: sub.FirstURL });
        }
      }
    }
    if (relatedTopics.length >= 8) break;
  }

  const answer = ddg.Answer && ddg.Answer.length > 0 ? ddg.Answer : null;
  const abstract = ddg.AbstractText && ddg.AbstractText.length > 0 ? ddg.AbstractText : null;
  const abstractSource = ddg.AbstractSource && ddg.AbstractSource.length > 0 ? ddg.AbstractSource : null;
  const abstractUrl = ddg.AbstractURL && ddg.AbstractURL.length > 0 ? ddg.AbstractURL : null;
  const empty = !answer && !abstract && relatedTopics.length === 0;

  return { query: q, answer, abstract, abstractSource, abstractUrl, relatedTopics, empty };
}

// ─── Tool Definitions + Handlers ───────────────────────────────────

const WEB_FETCH_DEF: ToolDefinition = {
  id: "web.fetch",
  name: "fetch",
  description:
    "Fetch the content of a public web URL (HTTP/HTTPS). Use this to retrieve " +
    "current external documentation, pages, or JSON APIs. SSRF-protected: " +
    "private/internal/metadata hosts are blocked. Returns the response body as text.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL to fetch" },
    },
    required: ["url"],
  },
  readOnly: true,
};

const WEB_SEARCH_DEF: ToolDefinition = {
  id: "web.search",
  name: "search",
  description:
    "Search the public web for current information (news, docs, prices, status). " +
    "Use this when the answer depends on data that may have changed after the " +
    "model's training cutoff. Returns real results; truthful empty when none.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  readOnly: true,
};

const WEATHER_FORECAST_DEF: ToolDefinition = {
  id: "weather.forecast",
  name: "forecast",
  description:
    "Get a real current U.S. weather forecast for a 5-digit ZIP code from the " +
    "National Weather Service. Returns structured periods (today/tomorrow/...) " +
    "with temperature, conditions, wind, and precipitation probability. Use this " +
    "for any weather/forecast question — never answer weather from memory.",
  inputSchema: {
    type: "object",
    properties: {
      zip: { type: "string", description: "5-digit U.S. ZIP code" },
    },
    required: ["zip"],
  },
  readOnly: true,
};

const REALTIME_META: ToolMetadata = {
  projectScoped: false,
  mutating: false,
  readOnly: true,
};

const webFetchHandler: ToolHandler = async (_ctx, args) => {
  const url = typeof args.url === "string" ? args.url : "";
  if (!url) {
    return { status: "failed", success: false, message: "Missing required arg: url", data: {} };
  }
  try {
    const res = await safeFetch(url);
    return {
      status: "success",
      success: true,
      message: `Fetched ${res.url} — ${res.status} (${res.bytes} bytes${res.truncated ? ", truncated" : ""})`,
      data: {
        url: res.url,
        status: res.status,
        contentType: res.contentType,
        content: res.content,
        bytes: res.bytes,
        truncated: res.truncated,
      },
    };
  } catch (err) {
    return {
      status: "failed",
      success: false,
      message: err instanceof Error ? err.message : String(err),
      data: { url },
    };
  }
};

const webSearchHandler: ToolHandler = async (_ctx, args) => {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query) {
    return { status: "failed", success: false, message: "Missing required arg: query", data: {} };
  }
  try {
    const res = await webSearch(query);
    return {
      status: "success",
      success: true,
      message: res.empty
        ? `No instant answers found for "${query}"`
        : `Search results for "${query}"`,
      data: res as unknown as Record<string, unknown>,
    };
  } catch (err) {
    return {
      status: "failed",
      success: false,
      message: err instanceof Error ? err.message : String(err),
      data: { query },
    };
  }
};

const weatherForecastHandler: ToolHandler = async (_ctx, args) => {
  const zip = typeof args.zip === "string" ? args.zip : "";
  if (!zip) {
    return { status: "failed", success: false, message: "Missing required arg: zip", data: {} };
  }
  try {
    const res = await weatherForecast(zip);
    return {
      status: "success",
      success: true,
      message: `Forecast for ${res.location.place}, ${res.location.state} (${res.location.zip}) — ${res.periods.length} period(s)`,
      data: res as unknown as Record<string, unknown>,
    };
  } catch (err) {
    return {
      status: "failed",
      success: false,
      message: err instanceof Error ? err.message : String(err),
      data: { zip },
    };
  }
};

/**
 * Realtime tool entries, merged into the default ToolRegistry so every
 * surface using @litt/agent-core gets web.search / web.fetch /
 * weather.forecast. All three are read-only and require no credentials,
 * so the ExecutionGateway allows them for untrusted (model) callers
 * without a grant.
 */
export const REALTIME_TOOL_ENTRIES: Record<string, ToolEntry> = {
  "web.fetch": { definition: WEB_FETCH_DEF, handler: webFetchHandler, metadata: REALTIME_META },
  "web.search": { definition: WEB_SEARCH_DEF, handler: webSearchHandler, metadata: REALTIME_META },
  "weather.forecast": { definition: WEATHER_FORECAST_DEF, handler: weatherForecastHandler, metadata: REALTIME_META },
};

/** IDs of the realtime tools — useful for parity tests across surfaces. */
export const REALTIME_TOOL_IDS = ["web.fetch", "web.search", "weather.forecast"] as const;
