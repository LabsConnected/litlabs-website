import path from "path";
import fs from "fs";
import { AgentWorkerMatrix } from "./lib/agent-worker";

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

const agentSlug = process.env.TARGET_AGENT_SLUG || "champion";
const maxConcurrency = parseInt(process.env.MAX_CONCURRENCY || "3", 10);
const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);

console.log(
  `\x1b[35m[🔱 DAEMON] Ignition loop triggered for agent matrix: [${agentSlug}]\x1b[0m`,
);

const worker = new AgentWorkerMatrix({
  agentSlug,
  pollIntervalMs,
  maxConcurrency,
});

process.on("SIGINT", () => {
  worker.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  worker.stop();
  process.exit(0);
});

worker.start().catch((err) => {
  console.error(
    "❌ Fatal crash sequence initiated in background daemon loop:",
    err,
  );
  process.exit(1);
});
