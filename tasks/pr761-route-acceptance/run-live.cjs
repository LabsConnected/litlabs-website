/**
 * PR #761 live route acceptance — drive the REAL probe code
 * (@litt/models probeOllamaRoute) against the REAL PC Ollama endpoints
 * over the LAN and Tailscale networks, then run real litt-fast:2k
 * generations on whichever endpoint the probe selected.
 *
 * Simulates the phone's view faithfully: the "local" tier points at a
 * dead port (the phone has no Ollama daemon of its own), so selection is
 * genuinely between LAN and Tailscale under OLLAMA_ROUTE_ORDER.
 *
 * Records per run: route tier, selected endpoint, network, model,
 * failures (probe attempts), probe latency, generation latency, and
 * tokens/second from Ollama's own eval counters.
 *
 * Usage: node run-live.cjs [--runs 3] [--out results.json]
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { probeOllamaRoute } = require(
  path.resolve(__dirname, "../../packages/litt-models/dist/ollama-route.js"),
);

const MODEL = "litt-fast:2k";
const RUNS_PER_ROUTE = (() => {
  const i = process.argv.indexOf("--runs");
  return i > -1 ? Number(process.argv[i + 1]) || 3 : 3;
})();
const OUT_PATH = (() => {
  const i = process.argv.indexOf("--out");
  return i > -1 ? process.argv[i + 1] : path.join(__dirname, "results.json");
})();

/** This PC's endpoints, exactly as the phone sees them. */
const ENDPOINTS = {
  lan: "192.168.0.112:11434",
  tailscale: "100.107.123.73:11434",
  /** Phone has no local daemon — dead port keeps the tier truthful. */
  localDead: "127.0.0.1:9",
};

function envFor(order, overrides = {}) {
  const map = {
    OLLAMA_LOCAL_URL: ENDPOINTS.localDead,
    OLLAMA_LAN_URL: ENDPOINTS.lan,
    OLLAMA_TAILSCALE_URL: ENDPOINTS.tailscale,
    OLLAMA_ROUTE_ORDER: order,
    ...overrides,
  };
  return (key) => map[key];
}

async function generate(endpoint, prompt) {
  const started = process.hrtime.bigint();
  const res = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      options: { num_predict: 32, temperature: 0 },
    }),
  });
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (!res.ok) {
    return { ok: false, status: res.status, wallMs, error: `HTTP ${res.status}` };
  }
  const body = await res.json();
  const evalCount = body.eval_count ?? 0;
  const evalDurationNs = body.eval_duration ?? 0;
  return {
    ok: true,
    wallMs,
    servedModel: body.model,
    evalCount,
    evalDurationNs,
    loadDurationNs: body.load_duration ?? 0,
    totalDurationNs: body.total_duration ?? 0,
    tokPerSec: evalDurationNs > 0 ? evalCount / (evalDurationNs / 1e9) : null,
    reply: (body.message?.content ?? "").slice(0, 60),
  };
}

async function runOnce(label, order, overrides = {}) {
  const probeStart = process.hrtime.bigint();
  const probe = await probeOllamaRoute({ getEnv: envFor(order, overrides) });
  const probeMs = Number(process.hrtime.bigint() - probeStart) / 1e6;

  const record = {
    scenario: label,
    routeOrderEnv: order,
    probeMs: Math.round(probeMs * 10) / 10,
    attempts: probe.attempts.map((a) => ({
      tier: a.tier, endpoint: a.endpoint, ok: a.ok, error: a.error,
    })),
    ok: probe.ok,
    tier: probe.tier,
    endpoint: probe.endpoint,
    endpointHasPinnedModel: probe.models.includes(MODEL),
    models: probe.models,
  };

  if (!probe.ok) {
    record.failure = probe.reason;
    return record;
  }
  if (!record.endpointHasPinnedModel) {
    record.failure = `selected endpoint lacks ${MODEL}`;
    return record;
  }

  const gen = await generate(probe.endpoint, "Reply with the single word: ok");
  record.generation = {
    ...gen,
    wallMs: Math.round(gen.wallMs * 10) / 10,
    tokPerSec: gen.tokPerSec == null ? null : Math.round(gen.tokPerSec * 100) / 100,
  };
  return record;
}

async function main() {
  const results = { startedAt: new Date().toISOString(), model: MODEL, runs: [] };

  // One untimed warm-up per endpoint so model-load time is honest
  // (load_duration is still recorded on every run).
  for (const tier of ["lan", "tailscale"]) {
    await generate(`http://${ENDPOINTS[tier]}`, "warm up");
  }

  for (let i = 1; i <= RUNS_PER_ROUTE; i++) {
    results.runs.push(await runOnce(`lan#${i} (order lan,tailscale,local)`, "lan,tailscale,local"));
  }
  for (let i = 1; i <= RUNS_PER_ROUTE; i++) {
    results.runs.push(await runOnce(`tailscale#${i} (order tailscale,lan,local)`, "tailscale,lan,local"));
  }
  // The PR's headline order: tailscale first with LAN dead → must fall
  // through to Tailscale (the phone-off-Wi-Fi case).
  results.runs.push(await runOnce(
    "tailscale-fallback (order tailscale,lan,local; LAN dead)",
    "tailscale,lan,local",
    { OLLAMA_LAN_URL: ENDPOINTS.localDead },
  ));
  // And the reverse: LAN first with Tailscale dead → must select LAN.
  results.runs.push(await runOnce(
    "lan-fallback (order lan,tailscale,local; tailscale dead)",
    "lan,tailscale,local",
    { OLLAMA_TAILSCALE_URL: ENDPOINTS.localDead },
  ));

  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2) + "\n");

  const fmt = (r) => {
    if (!r.ok) return `FAIL tier=${r.tier ?? "-"} reason=${r.failure}`;
    const g = r.generation;
    return (
      `${r.tier.padEnd(9)} ${r.endpoint} probe=${r.probeMs}ms ` +
      `gen=${g.wallMs}ms tok/s=${g.tokPerSec} model=${g.servedModel} ` +
      `pinned=${r.endpointHasPinnedModel}`
    );
  };
  for (const r of results.runs) console.log(`[${r.scenario}] ${fmt(r)}`);
  const pass = results.runs.every(
    (r) => r.ok && r.endpointHasPinnedModel && r.generation?.ok && r.generation.servedModel === MODEL,
  );
  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"} → ${OUT_PATH}`);
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
