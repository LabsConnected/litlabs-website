// Link preview — GET ?url=
// Server-side fetch with SSRF guard (deny private/loopback/link-local IPs via
// DNS resolution check, redirects validated hop-by-hop), 8s timeout, 2MB cap.
// DB-independent. Errors return 4xx/500 JSON — never a fabricated preview.
import { NextRequest, NextResponse } from "next/server";
import { promises as dns } from "dns";
import { withRateLimit } from "@/lib/rate-limiter";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isBlockedIp(ip: string): boolean {
  // IPv4 private/loopback/link-local ranges
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

async function hostResolvesToBlocked(hostname: string): Promise<boolean> {
  try {
    const [v4, v6] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    const ips = [...v4, ...v6];
    if (ips.length === 0) return true; // unresolvable → refuse
    return ips.some(isBlockedIp);
  } catch {
    return true;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function extractMeta(html: string, attr: "name" | "property", key: string): string | null {
  const re = new RegExp(
    `<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']{1,2000})["']`,
    "i",
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1].trim());
  // content before name variant
  const re2 = new RegExp(
    `<meta[^>]*content=["']([^"']{1,2000})["'][^>]*${attr}=["']${key}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1].trim()) : null;
}

async function getHandler(req: NextRequest) {
  const rawUrl = new URL(req.url).searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (current.protocol !== "https:") {
    return NextResponse.json({ error: "Only https URLs are allowed" }, { status: 400 });
  }

  try {
    let html = "";
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (await hostResolvesToBlocked(current.hostname)) {
        return NextResponse.json({ error: "URL host is not allowed" }, { status: 400 });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(current.toString(), {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            "User-Agent": "LiTTreeLinkPreview/1.0",
            Accept: "text/html,application/xhtml+xml",
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) {
          return NextResponse.json({ error: "Too many redirects" }, { status: 400 });
        }
        const next = new URL(location, current);
        if (next.protocol !== "https:") {
          return NextResponse.json({ error: "Redirect target must be https" }, { status: 400 });
        }
        current = next;
        continue;
      }

      if (!res.ok) {
        return NextResponse.json({ error: `Upstream returned ${res.status}` }, { status: 502 });
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(contentType)) {
        return NextResponse.json({ error: "URL is not an HTML page" }, { status: 400 });
      }
      const contentLength = Number(res.headers.get("content-length") ?? "0");
      if (contentLength > MAX_BYTES) {
        return NextResponse.json({ error: "Page too large" }, { status: 400 });
      }

      const reader = res.body?.getReader();
      if (!reader) {
        return NextResponse.json({ error: "Failed to read page" }, { status: 502 });
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_BYTES) {
          return NextResponse.json({ error: "Page too large" }, { status: 400 });
        }
        chunks.push(value);
        // Enough of the head to extract title/meta — stop early
        if (bytes > 200 * 1024) break;
      }
      const total = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        total.set(chunk, offset);
        offset += chunk.length;
      }
      html = new TextDecoder("utf-8").decode(total);
      break;
    }

    if (!html) {
      return NextResponse.json({ error: "Failed to fetch page" }, { status: 502 });
    }

    const titleMatch = html.match(/<title[^>]*>([^<]{1,500})<\/title>/i);
    const title =
      extractMeta(html, "property", "og:title") ?? (titleMatch ? decodeEntities(titleMatch[1].trim()) : null);
    const description =
      extractMeta(html, "property", "og:description") ?? extractMeta(html, "name", "description");
    let imageUrl = extractMeta(html, "property", "og:image");
    if (imageUrl) {
      try {
        const resolved = new URL(imageUrl, current);
        imageUrl = resolved.protocol === "https:" ? resolved.toString() : null;
      } catch {
        imageUrl = null;
      }
    }

    return NextResponse.json({
      url: current.toString(),
      title,
      description,
      imageUrl: imageUrl ?? null,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Preview fetch timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: "Failed to fetch preview" }, { status: 502 });
  }
}

export const GET = withRateLimit(getHandler, 30, 60);
