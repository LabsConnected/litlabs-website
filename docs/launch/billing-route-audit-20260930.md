# Billing launch audit — September 30, 2026

## Scope and evidence

Main audited: ad01ac9ccbb20c58d7c51aeeea2397156c4e46f1.
Existing billing PR #595: fix/billing-metering-bypass, f742096ab97aea9da8cc151188f76e599f3865bd.
Follow-up branch: codex/billing-media-spend-gates-20260930, based on #595 to reuse its gateway.
No merge, production write, provider call, secret output, or price change was performed.

IMPLEMENTED: #595 closes gemini/ai-chat text gateways and adds inner provider context to chat. This follow-up closes three additional SDK analysis paths and anonymous agent simulation spend in both chat routes. The provider requests/models remain unchanged.
TESTED: 124 tests across 11 billing/metering files passed. New tests cover auth denial, insufficient balance before SDK execution, charge/event linkage, successful response preservation, provider failure without debit, and billing-error behavior. Exact #595 baseline: 101 tests passed across 8 files.
LIVE VERIFIED: none. No simulated or mocked test is proof of live accounting.

One combined test run initially failed the existing failover metering assertion: its fixed 50ms sleep observed zero asynchronous event writes. Replaced the sleep with bounded observable-event polling; the final combined run passed all 124 tests. No production event behavior changed for that repair.
Targeted lint passed. Full typecheck reported four missing dependency declarations (@napi-rs/keyring in CLI credential-store twice; simple-git in terminal workspace scaffold/manager). No changed-file diagnostics appeared. Repository build is not verified.

## Traced provider paths

Classification means code-path audit, not live acceptance. “Cost only” can remain a P0 when no approved free policy or pre-spend gate exists.

| Path | Classification | Finding |
| --- | --- | --- |
| /api/gemini | METERED + CHARGED | #595 gateway preflight, positive wallet gate, per-attempt context, linked charge |
| /api/ai-chat | METERED + CHARGED | Same gateway; memory calls remain outside LLM accounting |
| /api/gemini/build | METERED + CHARGED | #595 spend gate and Gemini wrapper charge; production retry acceptance still required |
| /api/chat gallery branch | METERED + CHARGED | Flat agent-run precharge preserved; #595 adds provider cost context |
| /api/chat simulateResponse | METERED + CHARGED in follow-up | Auth + spend gate, shared agent runtime uses canonical gateway |
| /api/chat/unified llm | METERED + CHARGED | Agent entitlement/precharge plus post-success LLM charge; possible two charging classes need policy confirmation |
| /api/chat/unified simple | USER-CHARGED BUT COST MISSING | Agent precharge exists; generateText lacks provider metering context |
| /api/chat/unified agent simulateResponse | METERED + CHARGED in follow-up | Previously reached provider without authenticated identity; now rejected before execution |
| /api/agents/chat | METERED COST ONLY | #595 context only, no canonical balance gate or charge at route boundary |
| /api/conversations/[id]/messages | METERED COST ONLY | #595 explicitly defers full balance enforcement |
| /api/studio/conversations/[conversationId]/regenerate | METERED COST ONLY | #595 explicitly defers full balance enforcement |
| /api/studio/conversations/[conversationId]/messages | METERED COST ONLY / incomplete trace | Ambient context threaded into tools and text; full charge/gate chain requires further run-path proof |
| /api/media/analyze-image | METERED + CHARGED in follow-up | Shared SDK adapter gates before execute; actual returned token metadata charges canonical ledger |
| /api/media/analyze-video | METERED + CHARGED in follow-up | Same SDK adapter |
| /api/media/suggest-video-ideas | METERED + CHARGED in follow-up | Same adapter; malformed JSON retains successful-provider accounting, as before |
| /api/studio/generate Gemini branch | METERED COST ONLY / BYPASS | Explicit chargedBits:0, modeled provider cost hardcoded zero, no balance gate |
| /api/studio/generate Pollinations branch | FREE-BY-DESIGN | Public image URL, no platform provider credential |
| /api/media/transcribe | METERED COST ONLY | Direct Gemini, chargedBits:0, no pre-spend balance gate; policy not established |
| /api/media/generate-audio | METERED + CHARGED | Balance check, SDK execution, idempotent post-success canonical debit; provider retry cost completeness unproven |
| /api/media/generate-music | METERED + CHARGED | Same shape; debit occurs after provider spend |
| /api/media/generate-video | METERED + CHARGED | Durable job and canonical precharge/refund path; per-attempt provider costs need audit |
| /api/media/generate → generation/image-service | METERED + CHARGED / audit gap | Checks initial candidate price, falls through candidates, post-success debit; each failed attempt is not visibly accounted |
| /api/music/generate → music/generation-service | METERED + CHARGED | Atomic charge and unique generation claim before worker; provider-attempt ledger proof remains |
| /api/music/producer; /api/music/enhance-prompt | METERED COST ONLY | Text context present; user charge/gate not established |
| /api/voice/tts; /api/voice/speak-summary | FREE-BY-DESIGN | Code explicitly calls voice a core uncharged feature; provider costs/ceilings still need acceptance |
| /api/voice/realtime-token | METERED COST ONLY / incomplete | Issuance event chargedBits:0; token issuance cannot prove actual session spend |
| /api/demo/chat | FREE-BY-DESIGN | Server-limited anonymous demo, pinned text completion; no wallet identity by design |
| /api/debug/llm-test | FREE-BY-DESIGN / observability gap | Owner-only diagnostic generate/stream; no per-attempt metering context |
| /api/agent/chat | BYPASS / BUG | Shared bearer key authorizes paid generateText; no user metering or spend gate |
| /api/ai/chat → ai/providers | BYPASS / BUG | Authenticated Ollama fallback directly fetches paid OpenRouter without charge/context |
| /api/litt/think → ai/providers | METERED COST ONLY / BYPASS | OpenRouter fallback emits zero-token/zero-charge events, no balance gate |
| growth content-engine; growth-handlers rewrite → llm-completion | BYPASS / BUG | Direct OpenRouter fetch with no accounting; tool handler comment incorrectly says no paid API calls |
| agent-worker → llm-executor → llm-completion | BYPASS / BUG | Background task executor has no billable identity/context |
| missions/mission-executor | BYPASS / BUG candidate | Direct generateText without explicit context; caller/ambient gate proof still needed |
| agents.startBackgroundConversation | BYPASS / BUG candidate | Direct generateText without identity; caller reachability must be traced |
| litt-runtime/execution-engine | BYPASS / BUG candidate | Direct SDK tool call plus general LLM execution; accounting depends on callers |
| litt-intelligence/llm-tool-calling | METERED COST ONLY via agent loop | Loop metering tests pass; charging and budget authorization at each entry need live proof |
| generation/image-service provider adapters | METERED + CHARGED via service | Gemini, OpenAI, Alibaba, Fal, Together, Recraft etc.; wrappers alone are not safe bypass boundaries |
| visual-builds/providers; station-control/audio; music/providers/lyria | Incomplete caller trace | Provider implementations found; full authorization/charge chain not established here |
| ai/providers internal helpers | BYPASS / BUG via routes above | Direct OpenRouter request not canonical gateway |
| llm-completion Bedrock branch | DEAD / UNUSED candidate | Placeholder unsigned invoke; no production reachability proven |
| system-health; generation/health; integrations/status; model discovery | FREE-BY-DESIGN | Connectivity/catalog reads; provider hostname alone is not inference spend |
| CLI/model packages; terminal-server/litt-code; doctor | Separate execution target audit | CLI BYOK/local/remote semantics must remain stable; not assumed platform free merely because no browser wallet |

The discovery sweep included Gemini SDK calls, generateContent, generateText, streamText, provider API URLs, direct fetch wrappers, adapters, workers, background jobs, and their callers. Candidate classifications deliberately retain incomplete traces; this is not a claim that every repository paid spawn is fully verified safe.

## Remaining launch blockers

1. Paid routes and background paths above still bypass charge/gates. Fix through canonical gateways after tracing identity and logical action ownership; do not infer “free” from chargedBits:0.
2. #595/follow-up positive-balance checks are not reservations. Parallel actions can spend before either debit, and random per-request call IDs do not protect duplicate client retries. Requires a durable logical action claim/reservation and replay behavior; an in-memory map would not satisfy multi-instance correctness.
3. Exact pricing migration needs verification: getCreditBalances issues a new v1 1500 grant before ensureStarterTopUp checks a legacy account, potentially leaving legacy500 + v1 1500. No production migration test performed.
4. Accurate provider cost evidence remains modeled for unknown SDK models, image paths and failed requests with no token metadata. No invented zero cost should be treated as invoice truth.

## Production acceptance procedure — held for explicit owner merge authorization

Use designated disposable accounts and recorded before/after ledger queries; do not run these now.

A. Fresh Starter: create account, inspect one-time grant key starter:v1:{user UUID}, verify total 1500; repeat balance reads concurrently and verify no new grant rows.
B. Legacy Starter: establish a fixture with only legacy starter:{user UUID}=500; exercise balance load twice and concurrently; verify one starter:topup-v1 row of exactly1000 and lifetime grant1500, without a new1500 grant.
C. Retry storm: submit one stable logical action concurrently through the actual route, force N provider attempts with controlled provider faults, inspect stored usage_events/cost_events/credit_ledger; expect N truthful costs, one billable event and one debit. Verify unfunded requests have no outbound provider execution.
D. Top-up: complete a designated Stripe test payment, replay the same webhook concurrently, verify one grant matching purchased amount and exact resulting balance. Compare receipt/event IDs to ledger evidence.

Retain IDs, timestamps, sanitized provider request logs, ledger/event queries and browser/account evidence. Any inconsistency blocks Billing READY. No credentials should appear in retained artifacts.
