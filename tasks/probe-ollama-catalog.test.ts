import { describe, it } from "vitest";
import { toolRegistry } from "../src/lib/litt-intelligence/tool-registry";
import { registerInternalTools } from "../src/lib/litt-intelligence/tool-registry";

/**
 * Measurement probe — not a pass/fail test. Loads the REAL tool registry
 * catalog, serializes it to OpenAI tool JSON, then calls Ollama directly with
 * (a) the full catalog and (b) a task-reduced catalog to compare prompt-eval
 * cost, latency, and tool-pick quality on litt-hermes:16k / fast:8k.
 */

const OLLAMA = process.env.LITT_OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.PROBE_MODEL || "litt-hermes:16k";

const REDUCED = new Set([
  "files.list", "files.read", "files.write", "files.patch", "files.mkdir",
  "files.rename", "files.delete", "search_code", "build.run", "test.run",
  "typecheck.run", "lint.run", "preview.start", "preview.status",
  "checkpoint.create", "approval.request", "git.status",
]);

const SYS = [
  "You are LiTT Studio's build agent. You create real project files by calling",
  "tools. For a new static website, the entry file is index.html. Never print",
  "code in chat — write it via files.write. Start by writing the site's files.",
].join(" ");

const USER =
  "Build a one-page website for a fictional bistro called Cedar & Thyme. Warm theme, hero, a menu section with 4 dishes and prices, opening hours, and a reservation note in the footer. Plain HTML/CSS/JS only, no images.";

function toOai(t: { id: string; description?: string; inputSchema?: unknown }) {
  return {
    type: "function" as const,
    function: { name: t.id.replace(/\./g, "_"), description: t.description ?? "", parameters: t.inputSchema ?? { type: "object" } },
  };
}

async function probe(tools: unknown[], label: string) {
  const body = {
    model: MODEL,
    stream: false,
    keep_alive: "10m",
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: USER },
    ],
    tools,
    tool_choice: "required",
    options: { temperature: 0.15, num_predict: 4096 },
  };
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const elapsed = Date.now() - t0;
  const j = (await res.json()) as any;
  const msg = j.choices?.[0]?.message ?? {};
  const calls = (msg.tool_calls ?? []).map((c: any) => c.function?.name);
  console.log(
    `[catalog-probe] ${label} status=${res.status} elapsed=${elapsed}ms ` +
      `prompt_tokens=${j.usage?.prompt_tokens} completion_tokens=${j.usage?.completion_tokens} ` +
      `tools=${tools.length} calls=${JSON.stringify(calls)} textLen=${(msg.content ?? "").length}`,
  );
}

describe("ollama catalog measurement", () => {
  it("full vs reduced toolset", async () => {
    registerInternalTools();
    const all = toolRegistry.listEnabled();
    const full = all.map(toOai);
    const reduced = all.filter((t) => REDUCED.has(t.id)).map(toOai);
    console.log(`[catalog-probe] registry size=${all.length} reduced=${reduced.length}`);
    console.log(`[catalog-probe] full tools JSON bytes=${JSON.stringify(full).length} reduced=${JSON.stringify(reduced).length}`);
    await probe(reduced, "reduced");
    await probe(full, "full");
  }, 1_200_000);
});
