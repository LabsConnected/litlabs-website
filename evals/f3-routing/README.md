# LiTT F3 CHAT/BUILD routing + builder-output eval

Reproducible Promptfoo harness. No Promptfoo workspace existed in this repo
before this; this directory is the "if unavailable, create one" fallback.

$0 cost: local inference only, via PC Ollama. No provider API key is read or
required by anything here.

See `results/RESULTS.md` for the latest run's findings and exact evidence.

## Setup

```
cd evals/f3-routing
npm install   # pinned to promptfoo@0.103.0 — see RESULTS.md "Environment notes"
              # for why 0.124.x (latest) cannot run on Termux/Android
```

The canonical CLI must be built first (per repo AGENTS.md):

```
cd ../../packages/litt-models && pnpm build
cd ../litt-cli && pnpm build
```

## Run

```
# 1. Ground truth routing — real classifyIntent(), $0, instant
node node_modules/.bin/promptfoo eval -c promptfooconfig.routing-ground-truth.yaml \
  --no-cache --no-write -o results/routing-ground-truth.json

# 2. Model-only routing judge — informational, NOT authoritative (see RESULTS.md)
OLLAMA_BASE_URL=http://100.107.123.73:11434 \
  node node_modules/.bin/promptfoo eval -c promptfooconfig.routing-model-judge.yaml \
  --no-cache --no-write -o results/routing-model-judge.json

# 3. Real end-to-end builder-output check — actually runs the CLI + inspects
#    the filesystem. Slow (model inference per case); run sequentially (-j 1)
#    to avoid contending for the same Ollama endpoint with yourself.
LITT_OLLAMA_URL=http://100.107.123.73:11434 LITT_MODEL=qwen3:4b-instruct-fast \
  node node_modules/.bin/promptfoo eval -c promptfooconfig.builder-e2e.yaml \
  --no-cache --no-write -j 1 -o results/builder-e2e.json
```

`--no-write` is required on this setup — see RESULTS.md.

## Layout

- `provider/classify-direct.cjs` — calls the real compiled `classifyIntent()`
  from `packages/litt-cli/dist/lib/intent.js` directly. Ground truth.
- `provider/litt-e2e.cjs` — spawns `node packages/litt-cli/dist/index.js ask
  "<prompt>"` in a fresh scratch project per test and diffs the filesystem.
  Real end-to-end evidence, not model narration.
- `promptfooconfig.*.yaml` — the three eval configs described above.
- `cases/routing-cases.json` — the 6 F3 routing prompts as structured data
  (source of truth for the two routing configs' `tests:` blocks).
- `results/` — raw JSON output + `RESULTS.md` summary from the last run.
