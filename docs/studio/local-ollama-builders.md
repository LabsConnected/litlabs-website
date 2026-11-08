# Local Ollama Builder Models

LiTT's local website-builder lane runs on custom Ollama model builds. These
are local artifacts — each host must create them. This doc is the recreation
recipe; the runtime policy lives in
`src/lib/litt-intelligence/ollama-shared.ts`.

## Models and roles

| Tag | Base | ctx | Role |
|---|---|---|---|
| `litt-coder:16k` | `litt-coder:8k` (qwen2.5-coder 1.5B) | 16384 | **Primary local builder.** Only local model proven to complete the full Studio loop on CPU/GPU-bound hardware (~5–20s/turn, ~1.3GB, fits 100% in a 3GB GPU). Emits fenced `tool_call` blocks recovered by `normalizeTextToolCalls`. |
| `litt-builder:16k` | `litt-hermes:16k` (non-thinking hermes 4B) | 16384 | Quality fallback. Emits **native** `tool_calls` but exceeds interactive latency budgets on low-VRAM GPUs (>900s on a full-page write at 66% CPU offload). Never the automatic default. |
| `litt-builder:8k` | `litt-hermes:16k` | 8192 | Small-turn fallback only — the real build loop needs ~10k tokens and HTTP-400s at 8k. Reachable via explicit selection. |
| `litt-fast:2k` | — | 2048 | Default **chat** model. Not a builder. |
| `litt-coder:8k` | — | 8192 | Lightweight coding lane (pre-existing). |
| `litt-hermes-fast:*` | qwen3-thinking | varies | **Not tool-capable.** Weights emit a `reasoning` preamble even under `think:false` → zero tool calls on real prompts. Chat only; deliberately excluded from the picker's tool-capable flag. |

## Recreate on a new machine

Requires Ollama >= 0.40 and the base models already present
(`ollama pull` / existing `litt-*` builds).

```bash
# 1) litt-coder:16k — primary builder
cat > Modelfile.coder-16k <<'EOF'
FROM litt-coder:8k
PARAMETER num_ctx 16384
PARAMETER num_predict 4096
PARAMETER temperature 0.2
EOF
ollama create litt-coder:16k -f Modelfile.coder-16k

# 2) litt-builder:16k — optional quality fallback
cat > Modelfile.builder-16k <<'EOF'
FROM litt-hermes:16k
PARAMETER num_ctx 16384
PARAMETER num_predict 4096
PARAMETER temperature 0.2
PARAMETER top_k 40
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.05
EOF
ollama create litt-builder:16k -f Modelfile.builder-16k

# 3) litt-builder:8k — optional small-turn fallback
cat > Modelfile.builder-8k <<'EOF'
FROM litt-hermes:16k
PARAMETER num_ctx 8192
PARAMETER num_predict 4096
PARAMETER temperature 0.2
PARAMETER top_k 40
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.05
EOF
ollama create litt-builder:8k -f Modelfile.builder-8k

ollama list   # verify the three tags exist
```

## Enable the local builder lane (development)

Environment variables on the Next.js dev process — nothing is written to
`.env` files:

```bash
LITT_LOCAL_SMALL=1          # compact prompt + slim toolset for local models
OLLAMA_MODEL=litt-coder:16k # pin the builder (omit for auto-pick)
OLLAMA_TIMEOUT_MS=900000    # app-level budget for slow local turns
ALLOW_ANONYMOUS_DEV=true    # dev-only auth bypass — REMOVE after testing
```

- `OLLAMA_MODEL` is a dev override. Auto-pick (`preferredLocalToolModel`)
  prefers `litt-coder:16k` → `litt-builder:16k` → `litt-builder:8k`, skipping
  models whose window cannot hold the estimated prompt.
- The Studio model picker discovers local models via `/api/llm/health`
  (`toolCapable` + `recommended` flags).
- Production routing is untouched: `ollamaRouteEligible()` requires an
  `OLLAMA_ENDPOINT_*` env var on deployed hosts, so Railway never reaches a
  local daemon. Gemini remains the production primary.

## Verified (2026-11-05)

- 3 consecutive 12/12 end-to-end runs on `litt-coder:16k`: project → build →
  approval-gated `files.write` → preview 200 → `apply_patch` edit →
  persistence → ZIP export, ~42–96s per full run.
- Regression suite: `pnpm exec vitest run src/lib/litt-intelligence/llm-tool-calling-ollama.test.ts`
