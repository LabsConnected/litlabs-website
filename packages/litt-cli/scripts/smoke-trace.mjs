/**
 * smoke-trace.mjs — non-interactive provider-routing smoke test.
 *
 * Verifies the canonical fix: the header provider label comes from the
 * RESOLVED ADAPTER's providerId (execution truth), NOT from routed.servedBy
 * (routing intent). With OPENAI_API_KEY set, AUTO routing for a casual
 * prompt must resolve to the native OpenAI adapter and the request must
 * go to api.openai.com, never openrouter.ai.
 *
 * Usage:
 *   $env:OPENAI_API_KEY = "sk-..."   # passed inline, NOT written to any file
 *   node packages/litt-cli/scripts/smoke-trace.mjs
 *
 * Exits 0 on success, 1 on any assertion failure.
 */
import { ModelRuntime, brainLabel } from "../dist/lib/model-runtime.js";
import {
  resolveProviderAdapter,
  providerLabel,
  hasOpenRouterKey,
} from "../dist/lib/model-provider.js";

const PROMPT = "Are you good";

// ─── Pre-flight ────────────────────────────────────────────────────
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const hasOR = hasOpenRouterKey();
process.stderr.write(
  `[smoke] env: OPENAI_API_KEY=${hasOpenAI ? "SET" : "MISSING"} ` +
  `OPENROUTER_API_KEY=${hasOR ? "SET" : "MISSING"}\n`,
);
if (!hasOpenAI) {
  console.error("[smoke] FAIL: OPENAI_API_KEY is not set. Aborting.");
  process.exit(1);
}

// ─── Route (AUTO) ──────────────────────────────────────────────────
const rt = new ModelRuntime();
const routed = rt.route("auto", null, PROMPT);
const brain = brainLabel("auto", null, rt.registry);
process.stderr.write(
  `[smoke] routed: id=${routed.id} label=${routed.label} ` +
  `servedBy=${routed.servedBy} ` +
  `providerModelId=${routed.providerModelId ?? "(none)"} ` +
  `openRouterModelId=${routed.openRouterModelId ?? "(none)"} ` +
  `fallbackReason=${routed.fallbackReason ?? "(none)"}\n`,
);
process.stderr.write(`[smoke] brainLabel=${brain}\n`);

// ─── Resolve adapter (the controller's exact call) ─────────────────
const model = resolveProviderAdapter(routed, { tools: [] });
process.stderr.write(
  `[smoke] adapter: providerId=${model.providerId} ` +
  `configuredModel=${model.configuredModel}\n`,
);

const PROVIDER_LABEL = providerLabel(model.providerId);
const HEADER = `${brain} → ${routed.label} · ${PROVIDER_LABEL}`;
console.log(`HEADER: ${HEADER}`);

// ─── Assertions (pre-stream) ───────────────────────────────────────
const failures = [];
if (model.providerId !== "openai") {
  failures.push(
    `adapter.providerId expected "openai" (native BYOK), got "${model.providerId}"`,
  );
}
if (routed.servedBy !== "openai") {
  failures.push(
    `routed.servedBy expected "openai" (routing intent), got "${routed.servedBy}"`,
  );
}

// ─── Live stream — prove the request hits api.openai.com ───────────
// Capture the [litt-diag][FETCH-NATIVE] stderr line the adapter emits,
// and the meta event provider. Both are execution truth.
let capturedDiag = "";
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  const s = typeof chunk === "string" ? chunk : chunk.toString();
  capturedDiag += s;
  return origStderrWrite(chunk, ...rest);
};

let metaProvider = null;
let metaModel = null;
let resultContent = "";
try {
  const result = await model.stream(
    [{ role: "user", content: PROMPT }],
    (event) => {
      if (event.type === "meta") {
        metaProvider = event.provider;
        metaModel = event.model;
      }
    },
  );
  resultContent = result.content;
} finally {
  process.stderr.write = origStderrWrite;
}

process.stderr.write(
  `[smoke] stream: metaProvider=${metaProvider} metaModel=${metaModel} ` +
  `result.provider=${resultContent ? "(ok)" : "(empty)"} ` +
  `contentLen=${resultContent.length}\n`,
);
process.stderr.write(`[smoke] diag-capture:\n${capturedDiag}`);

// ─── Assertions (post-stream) ──────────────────────────────────────
if (metaProvider !== "openai") {
  failures.push(
    `stream meta.provider expected "openai", got "${metaProvider}"`,
  );
}
const nativeFetchLine = capturedDiag.match(/\[litt-diag\]\[FETCH-NATIVE\][^\n]*/);
if (!nativeFetchLine) {
  failures.push(
    "no [litt-diag][FETCH-NATIVE] line emitted — request did not go through the native adapter",
  );
} else {
  const hostMatch = nativeFetchLine[0].match(/host=([^\s]+)/);
  if (!hostMatch || hostMatch[1] !== "api.openai.com") {
    failures.push(
      `FETCH-NATIVE host expected api.openai.com, got "${hostMatch?.[1] ?? "(none)"}"`,
    );
  }
}
if (capturedDiag.includes("FETCH-OR")) {
  failures.push(
    "[litt-diag][FETCH-OR] line emitted — request leaked to OpenRouter",
  );
}
if (!resultContent || resultContent.trim().length === 0) {
  failures.push("stream returned empty content");
}

// ─── Report ────────────────────────────────────────────────────────
console.log(`META_PROVIDER: ${metaProvider}`);
console.log(`FETCH_HOST: ${nativeFetchLine?.[0]?.match(/host=([^\s]+)/)?.[1] ?? "(none)"}`);
console.log(`RESPONSE_PREVIEW: ${JSON.stringify(resultContent.slice(0, 120))}`);

if (failures.length > 0) {
  console.error("\n[smoke] FAILURES:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n[smoke] PASS — header truthfully shows OpenAI, request hit api.openai.com.");
process.exit(0);
