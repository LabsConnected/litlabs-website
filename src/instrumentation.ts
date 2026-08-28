export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Env preflight — fail fast on missing required config in deployed environments.
    // Non-deployed (local dev) only warns so the app still starts without secrets.
    try {
      const { runPreflight } = await import("./lib/env-preflight");
      const result = runPreflight();
      if (!result.ok && result.deployed) {
        // In production, log loudly but don't crash — the health endpoint
        // will report degraded and the release gate will catch it.
        // Crashing here would prevent the health endpoint from responding
        // at all, making debugging impossible.
        console.error("[instrumentation] Preflight failed in deployed environment — degraded mode");
      }
    } catch (e) {
      console.error("[instrumentation] Env preflight error:", e);
    }

    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "browser") {
    await import("../sentry.client.config");
  }
}
