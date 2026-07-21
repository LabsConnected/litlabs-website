import path from "path";
import fs from "fs";
import { AgentWorkerMatrix } from "./lib/agent-worker";

// Load .env.local if present (for local daemon runs outside Next.js)
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, "utf-8");
  envConfig.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const firstEquals = trimmed.indexOf("=");
    if (firstEquals === -1) return;
    const key = trimmed.substring(0, firstEquals).trim();
    let val = trimmed.substring(firstEquals + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  });
}

// Required environment for the persistent worker (never run on Vercel serverless)
const REQUIRED = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL", // fallback if SUPABASE_URL not set
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
];

function hasAny(keys: string[]) {
  return keys.some((k) => !!process.env[k]?.trim());
}

const missing: string[] = [];
if (!hasAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"])) missing.push("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!process.env.OPENROUTER_API_KEY?.trim()) missing.push("OPENROUTER_API_KEY");

if (missing.length) {
  console.error(
    "❌ [LiTTree Worker] Missing required environment variables:\n  " +
      missing.join("\n  ") +
      "\nThe autonomic worker cannot start without a database and LLM provider."
  );
  process.exit(1);
}

const agentSlug = process.env.TARGET_AGENT_SLUG || "director";
const maxConcurrency = parseInt(process.env.MAX_CONCURRENCY || "3", 10);
const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);

console.log(
  `\x1b[35m[🔱 DAEMON] Ignition loop triggered for agent matrix: [${agentSlug}] (concurrency=${maxConcurrency})\x1b[0m`,
);

const worker = new AgentWorkerMatrix({
  agentSlug,
  pollIntervalMs,
  maxConcurrency,
});

// Graceful shutdown: mark worker stopped in DB and exit cleanly
function shutdown(signal: string) {
  console.log(`\x1b[33m[🔱 DAEMON] Received ${signal}, shutting down...\x1b[0m`);
  try {
    worker.stop();
  } catch {}
  // Give heartbeat/stop a moment
  setTimeout(() => process.exit(0), 250);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

worker.start().catch(async (err) => {
  console.error(
    "❌ [LiTTree Worker] Fatal crash in background daemon loop:",
    err instanceof Error ? err.message : String(err),
  );
  // Best-effort: if the worker registered, surface the error on its row
  // (AgentWorkerMatrix already attempts to mark last_error on task failures;
  // daemon-level crash is harder without the instance id here.)
  process.exit(1);
});
