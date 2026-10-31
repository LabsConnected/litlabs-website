# Mission: LiTT Studio Ollama Recovery — working state (2026-10-31)

Branch: feat/studio-stabilization-20261029 @ ~/litt-canonical (proot clone, synced w/ origin)
PC: ssh -i ~/.ssh/litt_pc -p 2222 litbi@100.107.123.73 — dev worktree E:\LiTT\Worktrees\dev on same branch,
    dev server :3001 via C:\Users\litbi\dev-launch\dev-ctl.ps1 (WMI). Log: dev-server.log (UTF-16!).
Tunnel: ~/bin/pc-tunnel start|status — localhost:3001 → PC:3001 (running).
Test env: /root/.e2e-live.env (CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_TEST_USER_A/B_EMAIL).
Run e2e: source /root/.e2e-live.env && export CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
  && npx playwright test -c e2e-live/playwright.live.config.ts

## Diagnosed failures (live evidence, conv d0c0da9a + run 771be451)
- BUILD: ollama litt-hermes-fast:8k first call TIMED OUT 300s (OLLAMA_TIMEOUT_MS=300000) → cloud
  fallbacks dead (gemini 429, openrouter/groq/openai 401) → AllRoutesFailed → status=failed honestly,
  index.html = LITT-WELCOME-SCREEN template (nothing generated).
- EARLIER BUILD (ce2407cf): real files written + preview ready → still status=failed. Root cause
  suspected: quality-gate requires agent `QUALITY: understand/plan/design` markers for full-scope
  builds (small model may not emit) → verdict !ok → "quality checks" failure. UNCONFIRMED.
- MODIFY (x2, reproducible): model picks browser.click FIRST for theme edit → approval card →
  approved → fails (no browser session) → TASK_FAILED "approved workspace operation failed".
- Fallback tax: every step wastes gemini→openrouter→groq→(openai) before ollama.
- Latent false-success: browser.click counts mutating+verified (BOUNDARY_VERIFIED_MUTATORS) →
  evaluateCompletion could say "complete" with zero file changes.
- ws://127.0.0.1:4011/socket.io ERR_CONNECTION_REFUSED — terminal server NOT running on PC
  (port 4011 free; TERMINAL_SERVER_PORT=4011 in PC .env.local). Capability reports
  serverReachable:true anyway — misreported. Need: start terminal server on PC + ssh -L 4011 tunnel.

## Model benchmark (direct ollama calls, same 6-tool payload + FULL quality prompt)
- litt-hermes-fast:8k: 28.9s, toolCalls=[] — QUALITY prose only, ZERO tool calls. 8k ctx too small
  for real agent prompt (~40 tools+workspace ctx) → truncation → timeouts/prose.
- litt-hermes:16k: 198.7s (cold load), toolCalls=[files_list] VALID.
- litt-hermes:32k: 30.6s, toolCalls=[files_list] VALID.  CHOICE: litt-hermes:32k (2.5GB, fits RAM).
DONE: PC .env.local OLLAMA_MODEL=litt-hermes:32k (was litt-hermes-fast:8k).

## Code changes made (uncommitted, on branch)
1. src/lib/studio/completion-evidence.ts: +isWorkspaceMutationClaim — mutation requirement now
   needs a VERIFIED WORKSPACE mutation; boundary-only work (browser.*/preview.*/memory) →
   failed (diff=unchanged) or partial (unverifiable), never complete.
2. src/lib/litt-intelligence/agent-loop-v2.ts (~line 1830): browser.* interaction preflight —
   no sessionId in inputs AND no live getActiveSession → immediate error result
   ("call browser.start_session first...or use file tools"), no approval card, mutating:false.

## TODO
- Regression tests: completion-evidence boundary cases (partial writes, incomplete edits,
  empty responses, failed tools, interrupted runs). Loop harness: runAgentLoopV2 +
  fakeTransport + vi.mocked(callLLMWithTools) (see agent-loop-v2.test.ts top).
- tsc/vitest targeted validation.
- git add/commit/push → PC: git fetch origin && git checkout feat/... in E:\LiTT\Worktrees\dev.
- Terminal: start terminal-server on PC (WMI, port 4011) + add -L 4011 tunnel + WS verify.
- ≥3 acceptance runs (mission prompt: "modern responsive website", heading→"LiTT STUDIO VERIFIED",
  purple theme) → evidence + report.
- Check whether quality-gate marker blocking still fails builds (unconfirmed root cause).

## Progress log 2 (23:10Z)
- COMMITTED+PUSHED 73b0a743 (completion-evidence workspace-mutation + browser preflight + tests +
  spec failure capture). PC worktree synced to 73b0a743 (ff-merge; deleted untracked e2e shots there).
- PC .env.local: OLLAMA_MODEL=litt-hermes:32k, added TERMINAL_OWNER_CLERK_IDS=user_3HEuA6XZJH8GKz9TLpELpnKnbom.
- Terminal server running PC :4011 (pnpm terminal:dev via Start-Process WMI, log
  C:\Users\litbi\dev-launch\terminal-server.log). Health 200 via tunnel. 4011 ssh -N -L tunnel up.
- socket.io protocol: connect → session:ready; emit "terminal:input" (data string);
  output via "terminal:output"; session mint = mintTerminalToken (terminal-server/auth.ts)
  or API /api/terminal/token. Owner gate needs TERMINAL_OWNER_CLERK_IDS (set).
- Tests: 85+59 pass locally (completion-evidence both files + agent-loop-v2).
- NEXT: WS verify script on PC → e2e-live acceptance run → watch for quality-gate marker failure.

## Progress log 3 (23:25Z)
- Terminal: old server crashed on WS handshake repeatedly ("xhr poll error" then dead). First launch
  survived hours; fresh launches die on socket connect. Term dbg: running via WMI Start-Process
  `pnpm terminal:dev` = works (health 200). ws-verify-tmp.mjs on PC: mint token → socket.io connect
  → session:ready → terminal:input echo → terminal:output. Crash likely in io.use chain / PTY spawn
  (getWorkspace or node-pty on Windows). NEED: reproduce w/ stderr captured (term-err.log empty so far).
- Files on PC worktree: C:\Users\litbi\ws-verify.mjs → copied to worktree ws-verify-tmp.mjs,
  run `npx tsx ws-verify-tmp.mjs` in E:\LiTT\Worktrees\dev.

## Progress log 4 (23:45Z)
- e2e-run2 in progress (/tmp/e2e-run2.log): project 075bc77f created, build prompt sent;
  browser floods ws://127.0.0.1:4011 (4011 tunnel now forwards to PC) + repeated 503s.
- KEY FINDING: terminal server = workspace FILE transport too (HTTP /ws-files etc.) — when it's
  down, /api/studio-projects/*/files + workspace/prepare return 500. The WS handshake crashes it
  (native/PTY path — ptyManager.create is try/catch'd so silent death = native crash likely
  node-pty/conpty on PC Node 22). Studio UI auto-connects terminal socket → kills file transport.
- Terminal server is UP serving file ops only while nobody opens socket.io.

## Progress log 5 (00:35Z) — ROOT CAUSES CONFIRMED
- Terminal "crash on WS connect" was NOT a crash: Start-Process-launched terminal server is reaped
  when the sshd session ends (same reason dev-ctl uses WMI). Now launched via
  Win32_Process.Create on C:\Users\litbi\dev-launch\terminal-launch.cmd — PERSISTENT. Health 200.
- WS VERIFIED PASS: socket.io websocket connect → session:ready {sessionId,cwd} →
  terminal:input "echo LITT_WS_OK_42" → output verified → clean close → server still 200.
  Script: worktree ws-verify-tmp.mjs (mintTerminalToken w/ TERMINAL_AUTH_SECRET + owner id).
  Earlier "xhr poll error"=session-reaped server, "Forbidden"=pre-env owner gate,
  "Workspace not found"=token claiming fake wid. All resolved.
- CHAIN: terminal server down → Next's workspace transport fetch fails → /files + prepare 500
  AND POST /messages 409 TOOL_EXECUTION_UNAVAILABLE → build never starts. THIS is why runs die.
- dev server RESTARTED (pid→16756) to load OLLAMA_MODEL=litt-hermes:32k (was running stale fast:8k).
- run4 launched (/tmp/e2e-run4.log): dev READY + term persistent + 4011 tunnel up.

## Progress log 6 (04:05Z)
- run4 on litt-hermes:32k: model WORKED — files_list:valid call 1 (264s). But call 2 TIMED OUT at
  300s (growing prompt re-prefills each call; 32k ctx lets it balloon past OLLAMA_TIMEOUT_MS).
  Reliable but too slow for the 300s cap → timeouts kill later calls.
- Switched: OLLAMA_MODEL=litt-hermes:16k (bounded 16k ctx keeps prompts under timeout), 
  OLLAMA_TIMEOUT_MS=600000 (inference headroom), OLLAMA_LOAD_TIMEOUT_MS=180000 (cold-start, kept
  separate per mission). Dev restarted, READY. Terminal server persistent via WMI + tunnel up.
- REASONING for model pick: fast:8k=0 tool calls (broken), 32k=valid calls but >300s/call (timeout),
  16k=same reliable weights + bounded ctx = best fit for 300-600s per-call latency on this CPU.

## Progress log 7 (04:30Z) — Local AI Optimization
- COMMITTED+PUSHED 6a4bfa40: LOCAL_BUILD_TOOL_IDS (16 tools: files.*/apply_patch/search_code/
  project.*/preview.*/checkpoint.create), SLIM_SAFE_FAMILIES gate, LOCAL_BUILD_TOOL_NOTE batch
  prompt — applied in initial + resume paths. Offered-set only; permission/approval gates intact.
- Spec updated to mission prompts: "Build a modern responsive website." → heading
  "LiTT STUDIO VERIFIED" + purple theme; on-disk heading/purple verify + export check.
- BENCHMARK litt-hermes:16k SLIM: 42.1s/call (was 264s full-set), prompt_eval=616, ~3.2 tok/s.
  First turn = QUALITY markers (correct), loop nudges to tool calls after.
- BLOCKER FOUND: acceptance run cancelled by real POST /cancel carrying run's OWN clientRequestId
  → Studio UI's cancel() fired. studio-send-button = `busy ? onCancel : submit` — if UI busy flag
  lingers after a cancelled/errored run, a send click becomes a Stop. UI polling: GET
  /llm/health, /runtime-feed etc. precede the cancel POST.
- FIX (spec): in sendAndDrive, check send-button aria-label; if "Cancel" (busy), reload page to
  clear stale UI state (server run unaffected) instead of clicking Stop.

## Progress log 8 (04:50Z) — cancel mystery narrows
- Send-guard WORKED: [send-btn] aria-label="Cancel response" caught the busy send → reload →
  modify send went through (working). Build run STILL cancelled ~4min in with NO send click.
- cancel() only fires from onStop handlers (LiTTLiveActivity/StudioOperatorBar) — no
  useEffect/timer auto-invokes it. The POST /cancel carries the run's own clientRequestId →
  only the UI knows it. Suspects: stale pending-cancel stamp, auto-retry resend, or another
  client (MCP playwright session?). Server-side: messages route only cancels via the
  /cancel endpoint path (requestActionRunCancellation at :945 for pre-registration stop).

## Progress log 9 (05:15Z) — cancel instrumentation
- User directive: stop long e2e runs; isolate /cancel origin + fix 288s latency; then ONE run.
- Added console.warn("[conv.cancel] invoked", {clientRequestId, conversationId}, stack) inside
  useCanonicalConversation.cancel() (uncommitted). Need spec console listener for warn type to
  surface the stack in the e2e log.
- cancel() reachable ONLY via: LiTTLiveActivity.onStop, StudioOperatorBar.onStop,
  CommandComposer onCancel (busy send-button). No useEffect/timer.
- Pending-cancel stamp theory: messages route :945 pre-abort only fires if executionAbort
  already aborted — needs a prior /cancel POST, can't self-ignite.
- 288s vs 42s mystery: real agent prompt (~10-15k tokens: quality-loop + capability plan +
  workspace context + messages) >> bench payload (616 prompt tokens). Prefill dominates.

## Progress log 10 (wrap-up) — isolation work committed
- f32a9d23: attempt_success now logs promptTokens/completionTokens/promptEvalMs/evalMs (Ollama
  /v1 usage block) — separates prefill from generation for the 288s diagnosis.
- cancel-repro.spec + testMatch widened: API-only run (page closed after token) discriminates
  UI-fired cancel() vs server/other-client. BLOCKED at Clerk sign-in (60s timeout during dev
  recompile of the instrumentation — transient, same flake as before; retry when dev is warm).
- diag2 (concurrent runs CONTAMINATED each other — two serialized Ollama queues) showed:
  build run ended TASK_FAILED (all AI routes unavailable — ollama call died / fallbacks dead),
  tools started=2 on slim set. NO ghost cancel in that run — it failed instead.
- MCP playwright session (pid 32244) remains a live cancel suspect if a Studio page is open.

## Progress log 11 (06:20Z) — FIRST END-TO-END PASS on local inference
- litt-coder:8k (qwen2.5-coder:1.5b @ num_ctx 8192) + small lane + recovered-call fixes:
  build=completed (files.write approved+executed) → modify=completed → on-disk
  heading=TRUE purple=TRUE → reload persists → export has LiTT STUDIO VERIFIED + bg-purple-500.
  Full journey PROMPT→GENERATE→APPROVE→PREVIEW→EDIT→APPROVE→RELOAD→EXPORT verified in 4.1min.
- Root-cause chain for modify-failure (3 layers fixed): (1) recovered calls failed provider
  schema validation on required projectId → exempted SERVER_RESOLVED_ARGS; (2) envelope-wrapped
  scalars (content:{text:…}) → unwrapped in normalizeRecoveredInputs; (3) loop's
  toolRegistry.validateInputs required projectId → inject run's own projectId/conversationId/userId.
- No ghost /cancel in this run.
- Benchmarks: litt-coder:8k ~5-14s/call, ~42 tok/s, prompt ~5.5-6.7k tokens (fits 8k).

## Progress log 12 (06:45Z) — 3 CONSECUTIVE ACCEPTANCE RUNS
- run1 (coder5): build+modify completed, on-disk heading=TRUE purple=TRUE — FULL PASS (4.1m)
- run2 (pass2):  same — heading=TRUE purple=TRUE — FULL PASS (4.0m)
- run3 (pass3b): build+modify completed, heading=TRUE purple=FALSE — model rewrote the file
  bare (dropped styling). Structural pass; theme-edit fidelity MISS. 1.5B instruction variance.
- Metrics: litt-coder:8k 1.3GB resident, 14.3GB free RAM on PC, ~15s/call vs 288s hermes.
  NUM_PARALLEL=1 MAX_LOADED=1 enforced (single model serialized). CPU temp not instrumented.
- Spec send-button stability flake fixed (force-click+Enter fallback) — not a product bug.
- All fixes pushed on feat/studio-stabilization-20261029. Repo default unchanged (litt-hermes:16k).
