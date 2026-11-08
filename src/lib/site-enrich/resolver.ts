import "server-only";

/**
 * Image resolution for the static-site visual enrichment pass.
 *
 * Provider chain — every entry is free by construction; nothing here ever
 * hits a paid provider:
 *   1. Pexels stock search   (PEXELS_API_KEY — free tier, professional photography)
 *   2. LoremFlickr           (no key — real CC-licensed Flickr photos by keyword)
 *   3. Picsum                (no key — random real photography, guaranteed 200)
 *   4. Pollinations          (no key — free FLUX generation, best for custom art)
 *
 * Real-photography sources are deliberately probed before the AI
 * generator: acceptance counts real photos, and generated art is the
 * last-resort on-topic backstop, never the first pick.
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
 *  408/429, non-image payloads) are permanent, never retried. */
type ProbeOutcome = "ok" | "transient" | "permanent";

function probeOutcome(resp: Response | null): ProbeOutcome {
  if (!resp) return "transient";
  if (resp.ok && (resp.headers.get("content-type") ?? "").startsWith("image/")) return "ok";
  if (resp.status === 408 || resp.status === 429 || resp.status >= 500) return "transient";
  return "permanent";
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
  overall?: AbortSignal,
  attempts?: ProviderAttempt[],
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
    url.searchParams.set("per_page", "3");
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
      const transient = resp === null || resp.status === 408 || resp.status === 429 || resp.status >= 500;
      if (!transient) break;
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
    const photo = data.photos?.[0];
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

function loremFlickrUrl(keywords: string, seed: number): string {
  const kw = sanitizeKeywords(keywords) || "photo";
  return `${LOREMFLICKR_BASE}/1600/900/${encodeURIComponent(kw)}?lock=${seed}`;
}

function pollinationsUrl(keywords: string, seed: number): string {
  const kw = (keywords || "professional photography").replace(/,/g, " ");
  const prompt = `professional photograph of ${kw}, high quality, natural lighting`;
  return `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?width=1600&height=900&seed=${seed}&nologo=true`;
}

function picsumUrl(keywords: string): string {
  const seed = sanitizeKeywords(keywords).replace(/,/g, "-") || "site";
  return `${PICSUM_BASE}/${encodeURIComponent(seed)}/1600/900`;
}

/**
 * Resolve one image slot to a fetchable URL. `seed` dedupes identical
 * keywords so two "coffee" slots don't return the same photo. Network
 * failures degrade to the next provider — never throws.
 */
export async function resolveSlotImage(
  keywords: string,
  seed: number,
  overall?: AbortSignal,
  attempts?: ProviderAttempt[],
): Promise<ResolvedImage | null> {
  const kw = keywords.trim() || "professional photography";
  if (overall?.aborted) return null;

  const pexels = await tryPexels(kw, overall, attempts);
  if (pexels) return pexels;
  if (overall?.aborted) return null;

  // Free fallbacks — probe each before committing so a flaky host can't
  // write a broken reference into the site. Real photography first; the
  // AI generator is the on-topic backstop of last resort.
  const candidates: Array<{ url: string; provider: string }> = [
    { url: loremFlickrUrl(kw, seed), provider: "loremflickr" },
    { url: picsumUrl(kw), provider: "picsum" },
    { url: pollinationsUrl(kw, seed), provider: "pollinations" },
  ];
  for (const c of candidates) {
    if (overall?.aborted) return null;
    const ok = await probe(c.url, overall);
    attempts?.push({ provider: c.provider, status: ok ? "resolved" : "failed" });
    if (ok) {
      return { url: c.url, provider: c.provider, attribution: null };
    }
  }
  return null;
}
