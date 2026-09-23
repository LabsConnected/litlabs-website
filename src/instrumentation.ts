// Module-level guard so the signal handlers are installed exactly once
// even if register() is ever invoked more than once per process.
let shutdownHookInstalled = false;

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

  // Graceful shutdown for in-flight Studio agent runs. `next start` does
  // not install signal handlers, so without this a deployment cutover
  // (Railway SIGTERM) kills the container instantly: runs die with no
  // transcript writeback and the message row freezes as `streaming`.
  // Instead, abort active executions, persist a truthful `cancelled`
  // status per run, then exit. Guarded against double-invoke.
  if (process.env.NEXT_RUNTIME === "nodejs" && !shutdownHookInstalled) {
    shutdownHookInstalled = true;
    const runShutdown = async (signal: string): Promise<void> => {
      try {
        const { shutdownActiveExecutions } = await import("./lib/studio/shutdown");
        const result = await shutdownActiveExecutions(
          `Received ${signal} — shutting down Studio executions`,
        );
        console.log(`[instrumentation] Studio shutdown on ${signal}:`, result);
      } catch (e) {
        console.error("[instrumentation] Studio shutdown error:", e);
      } finally {
        // The writeback pass is time-bounded; exit promptly so the
        // platform never has to SIGKILL the old container.
        process.exit(0);
      }
    };
    process.once("SIGTERM", () => void runShutdown("SIGTERM"));
    process.once("SIGINT", () => void runShutdown("SIGINT"));
  }

  if (process.env.NEXT_RUNTIME === "browser") {
    await import("../sentry.client.config");
  }
}
