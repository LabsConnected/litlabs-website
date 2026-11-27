import { randomUUID } from "node:crypto";
import type { AgentLoopResult } from "@litt/agent-core";

export function parseAskArgs(args: string[]) {
  const separator = args.indexOf("--");
  const flags = separator < 0 ? args : args.slice(0, separator);
  const json = flags.includes("--json");
  const jsonl = flags.includes("--jsonl");
  const words = flags.filter((arg) => arg !== "--json" && arg !== "--jsonl");
  if (separator >= 0) words.push(...args.slice(separator + 1));
  return { question: words.join(" ").trim(), format: jsonl ? "jsonl" as const : json ? "json" as const : "text" as const, conflict: json && jsonl };
}

export function createAskOutput(format: ReturnType<typeof parseAskArgs>["format"]) {
  const runId = format === "text" ? "" : randomUUID();
  let sequence = 0;
  let done = false;

  function write(type: string, data: Record<string, unknown>) {
    process.stdout.write(JSON.stringify({
      version: 1, runId, sequence: ++sequence, timestamp: new Date().toISOString(), type, ...data,
    }) + "\n");
  }

  return {
    structured: format !== "text",
    event(type: string, data: Record<string, unknown>) {
      if (format === "jsonl" && !done) write(type, data);
    },
    finish(exitCode: number, termination: AgentLoopResult["termination"], data: Record<string, unknown> = {}) {
      if (format !== "text" && !done) {
        done = true;
        write("run.result", { termination, exitCode, ...data });
      }
      return exitCode;
    },
  };
}
