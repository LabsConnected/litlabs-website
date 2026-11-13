/**
 * download-media — save a generated media file (image / video / audio) to
 * the user's device.
 *
 * Generated media URLs are usually cross-origin provider URLs
 * (image.pollinations.ai, fal CDN, DashScope, …) or `data:` URLs.
 * Browsers IGNORE an anchor's `download` attribute for cross-origin URLs,
 * so a plain `<a href={url} download>` does not save anything — it just
 * opens the file in a new tab. Fetching the bytes into a same-origin
 * `blob:` object URL first makes the `download` attribute work.
 *
 * Falls back to a direct anchor click when the fetch fails (e.g. a
 * provider without CORS headers): same-origin URLs still download, and
 * cross-origin URLs at least open. The fallback deliberately does NOT
 * use `target="_blank"`, which suppresses the download path entirely.
 */
export async function downloadMediaFile(
  url: string,
  filename: string,
): Promise<void> {
  let href = url;
  let name = filename;
  let objectUrl: string | null = null;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    name = ensureExtension(filename, blob.type);
    objectUrl = URL.createObjectURL(blob);
    href = objectUrl;
  } catch {
    // CORS / network failure — use the direct-anchor fallback below.
  }

  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (objectUrl) {
    // Revoking synchronously can cancel the download in some browsers;
    // defer it (same pattern as AudioTool's download handler).
    const toRevoke = objectUrl;
    setTimeout(() => URL.revokeObjectURL(toRevoke), 1000);
  }
}

function ensureExtension(filename: string, mimeType: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(filename)) return filename;
  const subtype = (mimeType.split("/")[1] ?? "")
    .split(";")[0]
    .trim()
    .replace("jpeg", "jpg")
    .replace("+xml", "");
  return `${filename}.${subtype || "png"}`;
}
