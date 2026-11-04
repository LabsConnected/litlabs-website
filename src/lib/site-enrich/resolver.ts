import "server-only";

/**
 * Image resolution for the static-site visual enrichment pass.
 *
 * Provider chain — every entry is free by construction; nothing here ever
 * hits a paid provider:
 *   1. Pexels stock search   (PEXELS_API_KEY — free tier, professional photography)
 *   2. LoremFlickr           (no key — real CC-licensed Flickr photos by keyword)
 *   3. Pollinations          (no key — free FLUX generation, best for custom art)
 *   4. Picsum                (no key — random real photography, guaranteed 200)
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

/** Probe a candidate URL — a HEAD or ranged GET that must come back 200. */
async function probe(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-512" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    });
    return resp.ok && (resp.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

async function tryPexels(keywords: string): Promise<ResolvedImage | null> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return null;
  try {
    const url = new URL(PEXELS_API_URL);
    url.searchParams.set("query", keywords.replace(/,/g, " "));
    url.searchParams.set("per_page", "3");
    url.searchParams.set("orientation", "landscape");
    const resp = await fetch(url, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      photos?: Array<{
        src?: { large?: string; large2x?: string; original?: string };
        photographer?: string;
      }>;
    };
    const photo = data.photos?.[0];
    const download = photo?.src?.large2x ?? photo?.src?.large ?? photo?.src?.original;
    if (!download) return null;
    return {
      url: download,
      provider: "pexels",
      attribution: photo.photographer ? `Photo by ${photo.photographer} on Pexels` : "Pexels",
    };
  } catch {
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
): Promise<ResolvedImage | null> {
  const kw = keywords.trim() || "professional photography";

  const pexels = await tryPexels(kw);
  if (pexels) return pexels;

  // Free fallbacks — probe each before committing so a flaky host can't
  // write a broken reference into the site.
  const candidates: Array<{ url: string; provider: string }> = [
    { url: pollinationsUrl(kw, seed), provider: "pollinations" },
    { url: loremFlickrUrl(kw, seed), provider: "loremflickr" },
    { url: picsumUrl(kw), provider: "picsum" },
  ];
  for (const c of candidates) {
    if (await probe(c.url)) {
      return { url: c.url, provider: c.provider, attribution: null };
    }
  }
  return null;
}
