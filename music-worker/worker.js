/**
 * music-worker — persistent Railway worker service.
 *
 * Calls the web app's /api/music/worker endpoint every 2 minutes to
 * process pending and stale music generations.
 *
 * Why a separate service (not in-process in Next.js)?
 *   - Redeploys/restarts/replicas make in-process schedulers unreliable.
 *   - Railway's native Cron minimum interval is 5 minutes; we need 2.
 *   - A dedicated worker is the recommended Railway pattern for
 *     sub-5-minute recurring tasks.
 *
 * Environment variables:
 *   WEB_URL              — base URL of the web app (e.g. https://litlabs.net)
 *                         Required. Railway provides this via service
 *                         variable reference: ${{web.RAILWAY_PUBLIC_DOMAIN}}
 *   MUSIC_WORKER_SECRET  — shared secret for the x-worker-secret header.
 *                         Must match the web app's MUSIC_WORKER_SECRET.
 *   WORKER_INTERVAL_MS   — override the 2-minute interval (default: 120000).
 *
 * The worker never crashes — errors are logged and the interval continues.
 * Railway's restart policy handles catastrophic failures.
 */

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS) || 120_000;
const WEB_URL = process.env.WEB_URL;
const SECRET = process.env.MUSIC_WORKER_SECRET;

if (!WEB_URL) {
  console.error("[music-worker] FATAL: WEB_URL is not set. Set it to the web app's URL.");
  process.exit(1);
}
if (!SECRET) {
  console.error("[music-worker] WARNING: MUSIC_WORKER_SECRET is not set — requests will be rejected unless the web app is in dev mode (no secret configured).");
}

const ENDPOINT = `${WEB_URL.replace(/\/$/, "")}/api/music/worker`;

async function tick() {
  const ts = new Date().toISOString();
  try {
    const headers = { "Content-Type": "application/json" };
    if (SECRET) headers["x-worker-secret"] = SECRET;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "railway-music-worker" }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      console.error(`[${ts}] [music-worker] HTTP ${res.status}: ${text}`);
      return;
    }

    const data = await res.json().catch(() => null);
    const processed = data?.processed ?? data?.processedCount ?? "?";
    console.log(`[${ts}] [music-worker] OK — processed: ${processed}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${ts}] [music-worker] error: ${msg}`);
  }
}

console.log(`[music-worker] starting — endpoint: ${ENDPOINT}, interval: ${INTERVAL_MS}ms`);

// Fire immediately on startup, then on the interval.
tick();
setInterval(tick, INTERVAL_MS);

// Keep the process alive — never exit.
process.on("SIGTERM", () => {
  console.log("[music-worker] SIGTERM received — shutting down.");
  process.exit(0);
});
