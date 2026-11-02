# MISSION: LiTT Studio Ollama Recovery — Final Report

**Branch:** `feat/studio-stabilization-20261029` · **Date:** 2026-10-31 · **Verdict: FAIL on end-to-end acceptance (with all code-level defects fixed + honest failure classification verified)**

## Root causes — confirmed from live provider-router trace + e2e-live evidence

1. **Per-call latency vs. per-call timeout.** Local CPU inference on `litt-hermes` runs 264–424s/call
   against a 300s `OLLAMA_TIMEOUT_MS`. The agent loop needs ~5–15 calls for a build+edit; the 2nd+
   calls (growing prompt re-prefill) exceed the cap → `timeout` → all-routes-failed. **Honest `failed`,
   nothing written** (index.html stayed the LITT-WELCOME template — verified by export).
2. **Wrong tool selection + zero-tool replies (context overflow).** `litt-hermes-fast:8k` (8k ctx)
   cannot hold the ~40-schema agent prompt → it emits QUALITY prose with `toolCalls=[]` (0 tool
   calls) or picks `browser.click` for a file edit. Confirmed by direct benchmark.
3. **Latent false-success.** `browser.click`/`preview.start` counted as *verified mutations*, so a
   run doing only boundary work could report `complete` with the project file untouched.
4. **Dead approval cards.** A `browser.*` call with no live session surfaced as an Approve/Reject
   card; the user approved a call that could never succeed → `TASK_FAILED`.
5. **Probe fragility.** `/api/tags` is bounded by a 1500ms probe; a busy Ollama (serialized
   model-load) stalls it → the configured local route was hidden → cloud-only → all-routes-failed.
6. **Terminal = file transport, session-reaped.** The terminal server doubles as the workspace file
   transport. Start-Process launches were reaped when the sshd session ended → `/files` + `prepare`
   500 and `POST /messages` 409 `TOOL_EXECUTION_UNAVAILABLE` — the build never started. (Earlier
   "WS crash" was this reaping, not a real crash — node-pty spawn verified working.)

## Code changes (committed + pushed)

- **`73b0a743`** — `completion-evidence.ts`: `mutation` requirement now needs a **verified WORKSPACE
  mutation**; boundary-only work → `failed` (unchanged diff) or `partial` (unverifiable), never
  `complete`. `agent-loop-v2.ts`: `browser.*` **session preflight** before the permission gate — no
  live session → actionable error result (no approval card, `mutating:false`). Spec captures
  `projection.failure {code,message}`. Regression tests: boundary-only runs, partial writes,
  contradicted read-backs, interrupted runs (85 tests) + loop-level no-session test (59 tests).
- **`5ec49624`** — `llm-tool-calling.ts`: a busy-Ollama probe timeout no longer hides the configured
  `OLLAMA_MODEL` route (liveness decided by warm/inference calls, not a 1500ms probe).

## PC config (env, not committed)

`OLLAMA_MODEL=litt-hermes:16k` · `OLLAMA_TIMEOUT_MS=600000` (inference) · `OLLAMA_LOAD_TIMEOUT_MS=180000`
(cold-start — kept separate) · `TERMINAL_OWNER_CLERK_IDS` includes the e2e test user.

## Model benchmark (direct `/api/chat`, same 6-tool payload + FULL quality prompt)

| Model | Latency | Tool calls | Verdict |
|---|---|---|---|
| `litt-hermes-fast:8k` | 28.9s | **0** — QUALITY prose only | unusable (ctx too small) |
| `litt-hermes:16k` | 198.7s (cold) | `files_list` valid | reliable, fetch-failed under OOM |
| `litt-hermes:32k` | 30.6s (warm) | `files_list` valid | reliable, >300s/call in-loop |

Selected `litt-hermes:16k`: same reliable weights as 32k + bounded ctx keeps prompt under timeout.

## Terminal verification — PASS

Real socket.io session on `ws://127.0.0.1:4011`: `session:ready {sessionId,cwd}` → `terminal:input
echo LITT_WS_OK_42` → output verified → clean close → server healthy. Server now persistent via WMI
(`terminal-launch.cmd`). No port changes.

## Acceptance runs (real Clerk + local Ollama) — 6 attempts, all honest `failed`

- **771be451:** build `failed` (300s timeout, nothing written); modify `failed` (browser.click → no
  session → TASK_FAILED). Export = welcome template.
- **run4 (32k):** `files_list:valid` emitted (264s); call 2 timed out at 300s → `failed`.
- **run5/6 (16k):** probe timeout (busy Ollama) then `fetch failed` at 424s — Ollama runner died
  mid-generation (two 2.5GB models resident → OOM) → `failed`.

## Validation

`tsc --noEmit` clean · `eslint` 0 errors (2 pre-existing warnings) · vitest 144 pass
(completion-evidence ×2 + agent-loop-v2).

## Remaining blockers — hardware/capacity, not code

1. **Local CPU inference too slow for the multi-call agent loop** — ~4–6min/call × ~5–15 calls
   exceeds any reasonable end-to-end window on this PC.
2. **Ollama instability** — two resident 2.5GB models → runner OOM (`fetch failed` mid-generation).
3. **No reliable non-local route** — gemini 429 (quota ~exhausted), openrouter/groq/openai 401.
4. Therefore **3 consecutive PASS runs cannot be produced** on this stack today.

## Recommended next step (highest leverage)

Slim the offered tool surface + prompt for the local route (≈40 schemas → build-essential set). This
cuts prefill → ~2–3× faster calls → fewer timeouts AND fewer wrong-tool picks. Alternatively run the
flow on a working cloud route or faster local hardware.

**Production remains HOLD. No deployment authorized or performed.**

## Small-lane result (qwen2.5-coder:1.5b @ 8k ctx) — FUNCTIONAL, fidelity caveat

The lightweight local lane WORKS end-to-end: 3 consecutive acceptance runs each
completed PROMPT→GENERATE→APPROVE→PREVIEW→EDIT→APPROVE→RELOAD→EXPORT on local
inference in ~4min (vs unachievable at 288s/call on litt-hermes:16k).

Acceptance: 2/3 FULL PASS (heading+purple theme verified on disk + in export);
1/3 structural pass with theme-edit MISS (model rewrote file bare — 1.5B
instruction-following variance, not an orchestration defect). Heading landed 3/3.

Metrics: 1.3GB resident model, 14.3GB free PC RAM, ~15s/call, ~42 tok/s,
prompt ~5.5-6.7k tokens (fits 8k). Serialization + single residency enforced
via OLLAMA_NUM_PARALLEL=1 / MAX_LOADED_MODELS=1 / KEEP_ALIVE=1m.

Rollout recommendation per the approved plan: the lane is proven for generation
+ editing; keep Studio default as-is until theme-edit fidelity is acceptable, or
gate the lane behind LITT_LOCAL_SMALL for lightweight coding tasks.

## Lightweight reliability mission — 10-run result (litt-coder:8k)

Verdict: FAIL vs 10/10 acceptance — honest measured outcome below.

### Guard + prompt work (delivered, verified working)
- Destructive-rewrite guard (5be18d5b): files.write to an existing file reads prev,
  compares structural styling signatures (style blocks, stylesheet links, class/style
  attrs, media queries, fonts, semantic layout, tailwind); <40% retention is refused
  BEFORE persisting, with an actionable "read + apply_patch" error. Zero destructive
  rewrites observed across the loop; zero false-positives on builds (template sig <3).
- Small-lane prompt: files.read-first, apply_patch-preferred, emit ALL patches for
  multi-part requests. Model now reaches for apply_patch instead of full rewrites.

### 10-run results (health-gated loop, ~40min)
| Run | Build | Edit | Heading | Purple | Failure mode |
|-----|-------|------|---------|--------|--------------|
| 1 | — | — | — | — | UI flake (composer fill timeout) |
| 2 | failed | failed | F | F | transport write error |
| 3 | completed | completed | T | F | theme patch not applied |
| 4 | completed | completed | F | F | fidelity miss |
| 5 | completed | completed | T | T | — FULL PASS |
| 6 | completed | failed | F | F | edit failure |
| 7–9 | failed | failed | F | F | transport outage (sustained) |
| 10 | — | — | — | — | early fail (transport) |

Full journey completed: 3/10 · Heading: 2/10 · Purple: 1/10 · Full pass: 1/10.
No destructive rewrite in ANY run (guard objective met). No model concurrency
(NUM_PARALLEL=1/MAX_LOADED=1 enforced throughout).

### Root causes of the misses
1. PC terminal-server Node process crashes on module load (CJS loader stack in
   terminal-server.log), restarts, and files.write calls that land mid-crash fail —
   sustained outage 12:20–12:42 killed runs 7–10. Health gate only checks at run start.
2. 1.5B fidelity variance: heading lands ~30%, theme ~10–20% even with the
   multi-part prompt — exact-match apply_patch + multi-part instruction following
   are at the edge of this model's capability.
3. Occasional UI flakes (composer stability).

### Resources
Model resident 1.3GB · PC free RAM 7.3–14.3GB · ~15s/call ~42tok/s · CPU temp
UNAVAILABLE (MSAcpi_ThermalZoneTemperature n/a on this hardware) · CPU load ~85%.

### Recommendation
litt-hermes:16k stays Studio default — 10/10 is not achievable at 1.5B on this
evidence, and the transport crash-looping needs a watchdog/root-cause fix before
consecutive-run reliability is measurable. Keep the small lane behind
LITT_LOCAL_SMALL for lightweight tasks; the guard + prompt hardening are
worth keeping regardless (they cost nothing and proved effective).
Rollback: unset LITT_LOCAL_SMALL / OLLAMA_MODEL — all models preserved.
