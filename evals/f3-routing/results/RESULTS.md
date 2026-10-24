# F3 CHAT/BUILD routing + builder verification — results

Run date: 2026-10-19. Branch: `feature/f3-routing-eval`. Repo: canonical
`~/litt-canonical`, source SHA `97bbbcb9` (built fresh via
`packages/litt-models` → `packages/litt-cli` `pnpm build`, invoked directly
as `node packages/litt-cli/dist/index.js` — see "Environment notes" for why).

Model: `qwen3:4b-instruct-fast` via PC Ollama at `http://100.107.123.73:11434`.
$0 cost (local inference only, no provider API key configured anywhere in
any run).

Harness: Promptfoo **0.103.0** (pinned — see "Environment notes"), three
configs in this directory, raw JSON in this folder.

## 1. Routing — ground truth (`promptfooconfig.routing-ground-truth.yaml`)

Calls the REAL, deployed `classifyIntent()` (`packages/litt-cli/src/lib/intent.ts`),
the exact function the interactive cockpit calls at `ink/controller.ts:2181`
to decide CHAT vs MISSION ("BUILD"). $0, deterministic, no model call.

**6/6 PASS.**

| id | bucket | prompt | classifyIntent() |
|---|---|---|---|
| explicit-build-1 | explicit_build | "Build me a simple personal portfolio website with an index.html homepage." | `mission` |
| explicit-build-2 | explicit_build | "Create a new project here and scaffold a basic Express API server." | `mission` |
| normal-chat-1 | normal_conversation | "Hey, how's it going today?" | `chat` |
| normal-chat-2 | normal_conversation | "What's the difference between let and const in JavaScript?" | `chat` |
| ambiguous-1 | ambiguous | "I don't know, maybe we should look at this later." | `chat` |
| ambiguous-2 | ambiguous | "Something's off with the thing we talked about." | `chat` |

This is the authoritative result for F3 step 3.

## 2. Routing — model-only judge (`promptfooconfig.routing-model-judge.yaml`)

qwen3:4b-instruct-fast asked directly to label the same 6 prompts CHAT/BUILD,
with **no access to LiTT's code**. Informational only — per task step 5 this
track is explicitly NOT authoritative.

**6/6 agreed with ground truth** on this prompt set. This agreement is a
property of these particular prompts, not a guarantee — see section 3, where
the model's own narration ("Agent completed") flatly contradicts the real
outcome. Model self-report and real system behavior are different things
even when they happen to agree.

## 3. Builder-output — REAL end-to-end (`promptfooconfig.builder-e2e.yaml`)

Each case runs the canonical CLI directly (`node packages/litt-cli/dist/index.js
ask "<prompt>"`) in a fresh scratch git repo, then diffs the real filesystem
before/after. Assertions check actual files, never model narration.

**2/3 PASS, 1/3 FAIL.**

| id | expectation | result | evidence |
|---|---|---|---|
| genuine-build | build request persists `index.html` | **FAIL** | `newFiles: []`. CLI reported `exitCode: 0`, `"Agent completed"` (4 tool calls, 92.8s). Real tool trace: `project.run` to write `index.html` → **"Approval denied or not available"**. Model's own final text: *"I cannot create or verify index.html... The environment does not permit file operations for this task."* |
| non-build-chat | no builder files appear | PASS | `newFiles: []`, 0 tool calls |
| ambiguous-preserves-exact-prompt | exact original prompt reaches the model unmodified | PASS | CLI's own `▶ Asking:` line contains the literal, unparaphrased prompt text |

### The genuine-build failure, demonstrated twice more outside the harness

To rule out "headless-only" as the sole cause, the same prompt was also run
through a **real interactive approval** (via `expect`, auto-answering "y" to
every approval prompt — i.e. a human saying yes):

- Still **zero files persisted**.
- Root cause #2, independent of approval policy: `project.run`'s
  `ShellExecutor` invokes `spawn(command, args)` with **no shell**
  (execFile-style). The model naturally emits shell syntax to write a file —
  `echo '<html>...' > index.html` — and `>` only means redirection inside an
  actual shell. Node's `spawn` instead tries to execute a binary literally
  named `echo '<html>...' > index.html`, which doesn't exist:
  `ENOENT`. Confirmed twice (two different attempted commands, both ENOENT).

So there are **two independent, fully demonstrated reasons the builder does
not work today**, not one:
1. Headless/non-interactive execution (how any scripted eval or automation
   calls `litt ask`) fails closed on any mutating tool call — by design,
   confirmed correct/intentional behavior, not a bug.
2. Even WITH a human approving every prompt, `project.run` cannot execute
   the shell-syntax commands a model naturally produces to write a file —
   this IS a bug/gap, independent of approval policy.

Additionally: `project.run`'s known-command risk classifier (`classifyCommand`
in `packages/litt-agent-core/src/execution.ts`) doesn't recognize `echo`,
`touch`, or `bash` at all, so they fall through to the `elevated` /
`arbitrary_code` bucket — correct conservative behavior, but it means there
is no "safe," pre-classified way for the model to write a single file even
if the shell-invocation bug above were fixed.

## 4. Minor secondary finding

In the genuine-build trace, `project.list_files` called with `path: ""`
attempted `scandir('/')` (the real OS root) rather than the sandboxed
project root, and failed with `EACCES`. It didn't leak anything here only
because of filesystem permissions in this environment — the empty-path
fallback itself looks like an unintended default and is worth a look
separately from the builder-output question above.

## 5. Environment notes (affect reproducibility — read before rerunning)

- **promptfoo 0.124.1 does not run on Termux/Android (aarch64).** It hard
  dependency on `libsql`, which ships no `@libsql/android-arm64` binary —
  confirmed by actually installing and running it (`Cannot find module
  '@libsql/android-arm64'`). **0.103.0** (pinned in `package.json`) uses
  `better-sqlite3` instead, which builds fine here. Use `--no-write` when
  running — this version's local results-DB write path throws
  `SQLITE_CONSTRAINT_FOREIGNKEY` on this setup regardless of DB-file state;
  `--no-write` skips that path entirely and all this harness's own
  assertions still work without it.
- **The global `litt` the user runs is NOT the canonical build.** The `litt`
  shell function (wherever it's defined — not in this repo) unconditionally
  prefers `~/LiTT/bin/litt` — a separate, pre-existing standalone build —
  over anything `pnpm link --global` points at, for every subcommand this
  harness used (`ask`). `pnpm link --global` from
  `packages/litt-cli` also failed outright here anyway (global pnpm bin dir
  not on `PATH`). This harness bypasses all of that by invoking
  `node packages/litt-cli/dist/index.js` directly, per AGENTS.md's
  instruction not to use retired/stale copies. Anyone rerunning this must do
  the same — running bare `litt ask ...` from a shell will silently test
  the wrong binary.
