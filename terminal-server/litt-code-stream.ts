// Streaming bridge: reads prompt from LITT_LOCAL_PROMPT_B64, streams NDJSON
// events to stdout. Designed to be consumed line-by-line by the LiTT Code
// cockpit shell. Also supports a "health" mode via LITT_MODE=health.
//
// Usage:
//   LITT_LOCAL_PROMPT_B64=<b64> pnpm exec ts-node --transpile-only litt-code-stream.ts
//   LITT_MODE=health             pnpm exec ts-node --transpile-only litt-code-stream.ts

import { streamLiTTCode, health, type LiTTEvent } from "./litt-code";

function emit(e: LiTTEvent): void {
  process.stdout.write(JSON.stringify(e) + "\n");
}

async function main(): Promise<void> {
  const mode = process.env.LITT_MODE;

  if (mode === "health") {
    const ms = await health();
    process.stdout.write(JSON.stringify({ type: "health", ms }) + "\n");
    process.exit(ms >= 0 ? 0 : 1);
  }

  const b64 = process.env.LITT_LOCAL_PROMPT_B64 || "";
  const prompt = Buffer.from(b64, "base64").toString("utf8");
  if (!prompt.trim()) {
    emit({ type: "error", message: "empty prompt" });
    process.exit(1);
  }

  try {
    await streamLiTTCode(prompt, emit);
    process.exit(0);
  } catch (e) {
    // error event already emitted inside streamLiTTCode
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exit(1);
});
