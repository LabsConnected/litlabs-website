import "server-only";

/**
 * Image resolution for the static-site visual enrichment pass.
 *
 * Provider chain — every entry is free by construction; nothing here ever
 * hits a paid provider:
 *   1. Pexels stock search   (PEXELS_API_KEY — free tier, professional photography)
 *   2. Openverse             (no key — CC-licensed real photography, commercial-safe)
 *   3. LoremFlickr           (no key — real CC-licensed Flickr photos by keyword)
 *   4. Pollinations          (no key — free FLUX generation, best for custom art)
 *   5. Picsum                (no key — random real photography; FINAL fallback)
 *
 * Real-photography sources are deliberately probed before the AI
 * generator: acceptance counts real photos, and generated art is the
 * last-resort on-topic backstop, never the first pick. Picsum stays last
 * because it is keyword-agnostic (any seed yields a valid photo) — it is
 * the floor that keeps the 3-photo guarantee alive when every curated
 * source flakes.
 *
 * Returns the first publicly-fetchable URL. Callers download + save via
 * insertAssetFromUrl, which validates the payload before it ever reaches
 * the workspace.
 */

export interface ResolvedImage {
  url: string;
  provider: string;
  attribution: string | null;
}

/** One provider-lane outcome for run evidence: "unconfigured" means the
 *  provider's credential env was absent (never attempted); "failed" means
 *  it was probed and did not yield a fetchable image. */
export type ProviderAttempt = {
  provider: string;
  status: "resolved" | "failed" | "unconfigured";
};

const PROBE_TIMEOUT_MS = 12_000;
const PEXELS_API_URL = "https://api.pexels.com/v1/search";
const OPENVERSE_API_URL = "https://api.openverse.org/v1/images/";
const LOREMFLICKR_BASE = "https://loremflickr.com";
const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";
const PICSUM_BASE = "https://picsum.photos/seed";

function sanitizeKeywords(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join(",");
}

/** Retryable upstream condition — worth one more attempt before
 *  disqualifying the provider. Definitive answers (4xx other than
 *  402/408/429, non-image payloads) are permanent, never retried.
 *  402 is transient here on purpose: pollinations intermittently answers
 *  402 for identical requests (observed 2026-11-10), so one paid-gate
 *  blip must not kill the lane for the whole slot. */
type ProbeOutcome = "ok" | "transient" | "permanent";

function probeOutcome(resp: Response | null): ProbeOutcome {
  if (!resp) return "transient";
  if (resp.ok && (resp.headers.get("content-type") ?? "").startsWith("image/")) return "ok";
  if (resp.status === 402 || resp.status === 408 || resp.status === 429 || resp.status >= 500) return "transient";
  return "permanent";
}

function isTransientStatus(status: number): boolean {
  return status === 402 || status === 408 || status === 429 || status >= 500;
}

/** Per-attempt signal: the probe's own timeout, cut short by the caller's
 *  overall enrichment deadline when one is given. Without the overall
 *  signal a stalled provider can burn the full probe timeout on every
 *  attempt — and the caller retries across providers, so the total is
 *  unbounded (CI #820: the resume loop hung past vitest's 5s timeout).
 *  AbortSignal.any is NOT used here on purpose: jsdom (the test env)
 *  does not implement it, so combine manually with an AbortController. */
function fetchSignal(overall?: AbortSignal): AbortSignal {
  const perAttempt = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  if (!overall) return perAttempt;
  if (overall.aborted || perAttempt.aborted) {
    const already = new AbortController();
    already.abort();
    return already.signal;
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  perAttempt.addEventListener("abort", onAbort, { once: true });
  overall.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

/** Probe a candidate URL — a HEAD or ranged GET that must come back 200.
 *  One immediate retry on transient failures: a dropped connection or
 *  single-request 503 must not disqualify an otherwise healthy provider;
 *  a blip lasting longer falls through to the next provider as before. */
async function probe(url: string, overall?: AbortSignal): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (overall?.aborted) return false;
    let resp: Response | null = null;
    try {
      resp = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-512" },
        signal: fetchSignal(overall),
        redirect: "follow",
      });
    } catch {
      resp = null;
    }
    const outcome = probeOutcome(resp);
    if (outcome === "ok") return true;
    if (outcome === "permanent") return false;
  }
  return false;
}

async function tryPexels(
  keywords: string,
  seed: number,
  overall?: AbortSignal,
  attempts?: ProviderAttempt[],
  avoidUrls?: ReadonlySet<string>,
): Promise<ResolvedImage | null> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) {
    attempts?.push({ provider: "pexels", status: "unconfigured" });
    return null;
  }
  if (overall?.aborted) return null;
  try {
    const url = new URL(PEXELS_API_URL);
    url.searchParams.set("query", keywords.replace(/,/g, " "));
    url.searchParams.set("per_page", "6");
    url.searchParams.set("orientation", "landscape");
    let resp: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (overall?.aborted) return null;
      try {
        resp = await fetch(url, {
          headers: { Authorization: key },
          signal: fetchSignal(overall),
        });
      } catch {
        resp = null;
      }
      if (resp !== null && !isTransientStatus(resp.status)) break;
    }
    if (!resp?.ok) {
      attempts?.push({ provider: "pexels", status: "failed" });
      return null;
    }
    const data = (await resp.json()) as {
      photos?: Array<{
        src?: { large?: string; large2x?: string; original?: string };
        photographer?: string;
      }>;
    };
    // Skip results whose URL was already resolved this run — a repeated
    // photo would fail the content-hash dedupe downstream anyway.
    const photos = data.photos ?? [];
    const photo = photos.find((p) => {
      const u = p.src?.large2x ?? p.src?.large ?? p.src?.original;
      return u && !avoidUrls?.has(u);
    }) ?? photos[0];
    const download = photo?.src?.large2x ?? photo?.src?.large ?? photo?.src?.original;
    if (!download) {
      attempts?.push({ provider: "pexels", status: "failed" });
      return null;
    }
    attempts?.push({ provider: "pexels", status: "resolved" });
    return {
      url: download,
      provider: "pexels",
      attribution: photo?.photographer ? `Photo by ${photo.photographer} on Pexels` : "Pexels",
    };
  } catch {
    attempts?.push({ provider: "pexels", status: "failed" });
    return null;
  }
}

interface OpenverseResult {
  url?: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
}

/**
 * Openverse (api.openverse.org) — CC-licensed real photography, no API key.
 * `license_type=commercial` excludes NC/ND licenses up front so every
 * result is safe to ship in a paid product; `size=large` keeps downloads
 * comfortably above the >8KB acceptance floor. The `seed` rotates which
 * result is picked so repeated calls for one topic don't collide.
 */
async function tryOpenverse(
  keywords: string,
  seed: number,
  overall?: AbortSignal,
  attempts?: ProviderAttempt[],
  avoidUrls?: ReadonlySet<string>,
): Promise<ResolvedImage | null> {
  if (overall?.aborted) return null;
  try {
    const url = new URL(OPENVERSE_API_URL);
    url.searchParams.set("q", keywords.replace(/,/g, " "));
    url.searchParams.set("license_type", "commercial");
    url.searchParams.set("size", "large");
    url.searchParams.set("page_size", "10");
    let resp: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (overall?.aborted) return null;
      try {
        resp = await fetch(url, { signal: fetchSignal(overall) });
      } catch {
        resp = null;
      }
      if (resp !== null && !isTransientStatus(resp.status)) break;
    }
    if (!resp?.ok) {
      attempts?.push({ provider: "openverse", status: "failed" });
      return null;
    }
    const data = (await resp.json()) as { results?: OpenverseResult[] };
    const results = (data.results ?? []).filter(
      (r) => typeof r.url === "string" && r.url.startsWith("https://") && r.license,
    );
    if (results.length === 0) {
      attempts?.push({ provider: "openverse", status: "failed" });
      return null;
    }
    // Rotate by seed, skipping URLs already resolved this run.
    const start = Math.abs(seed) % results.length;
    let picked: OpenverseResult | undefined;
    for (let i = 0; i < results.length; i++) {
      const candidate = results[(start + i) % results.length];
      if (!avoidUrls?.has(candidate.url!)) {
        picked = candidate;
        break;
      }
    }
    picked ??= results[start];
    const license = [picked.license, picked.license_version].filter(Boolean).join(" ");
    attempts?.push({ provider: "openverse", status: "resolved" });
    return {
      url: picked.url!,
      provider: "openverse",
      attribution:
        `${license ? `${license} — ` : ""}${picked.title || "image"}` +
        `${picked.creator ? ` by ${picked.creator}` : ""} (openverse.org)`,
    };
  } catch {
    attempts?.push({ provider: "openverse", status: "failed" });
    return null;
  }
}

function loremFlickrUrl(keywords: string, seed: number): string {
  const kw = sanitizeKeywords(keywords) || "photo";
  return `${LOREMFLICKR_BASE}/1600/900/${encodeURIComponent(kw)}?lock=${seed}`;
}

function pollinationsUrl(keywords: string, seed: number): string {
  const kw = (keywords || "professional photography").replace(/,/g, " ");
  const prompt = `professional photograph of ${kw}, high quality, natural lighting`;
  return `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?width=1600&height=900&seed=${seed}&nologo=true`;
}

function picsumUrl(keywords: string, seed: number): string {
  // Picsum is the FINAL fallback: keyword-agnostic but always valid. The
  // seed suffix varies the photo per attempt so repeated resolves for
  // one topic don't collapse onto the same image.
  const base = sanitizeKeywords(keywords).replace(/,/g, "-") || "site";
  return `${PICSUM_BASE}/${encodeURIComponent(`${base}-${seed}`)}/1600/900`;
}

/**
 * Resolve one image slot to a fetchable URL. `seed` dedupes identical
 * keywords so two "coffee" slots don't return the same photo. Network
 * failures degrade to the next provider — never throws.
 *
 * `exclude` skips providers the caller already tried and whose DOWNLOAD
 * failed after a successful probe — a provider that serves a broken or
 * oversized payload must not be re-selected for the same slot.
 *
 * `avoidUrls` skips candidate URLs the caller already resolved this run,
 * preventing duplicate photos across slots/gallery fills.
 */
export async function resolveSlotImage(
  keywords: string,
  seed: number,
  overall?: AbortSignal,
  attempts?: ProviderAttempt[],
  exclude?: ReadonlySet<string>,
  avoidUrls?: ReadonlySet<string>,
): Promise<ResolvedImage | null> {
  const kw = keywords.trim() || "professional photography";
  if (overall?.aborted) return null;

  if (!exclude?.has("pexels")) {
    const pexels = await tryPexels(kw, overall, attempts, avoidUrls);
    if (pexels) return pexels;
    if (overall?.aborted) return null;
  }

  if (!exclude?.has("openverse")) {
    const openverse = await tryOpenverse(kw, seed, overall, attempts, avoidUrls);
    if (openverse) return openverse;
    if (overall?.aborted) return null;
  }

  // Free fallbacks — probe each before committing so a flaky host can't
  // write a broken reference into the site. Real photography first; the
  // AI generator is the on-topic backstop; Picsum is the final floor.
  const candidates: Array<{ url: string; provider: string }> = [
    { url: loremFlickrUrl(kw, seed), provider: "loremflickr" },
    { url: pollinationsUrl(kw, seed), provider: "pollinations" },
    { url: picsumUrl(kw, seed), provider: "picsum" },
  ];
  for (const c of candidates) {
    if (overall?.aborted) return null;
    if (exclude?.has(c.provider)) continue;
    if (avoidUrls?.has(c.url)) continue;
    const ok = await probe(c.url, overall);
    attempts?.push({ provider: c.provider, status: ok ? "resolved" : "failed" });
    if (ok) {
      return { url: c.url, provider: c.provider, attribution: null };
    }
  }
  return null;
}
