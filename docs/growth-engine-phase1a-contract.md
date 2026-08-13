# LiTT Growth Engine — Phase 1a Implementation Contract

**Status:** Architecture-locked. No production code written yet. This is the
file-by-file build contract, grounded in the actual codebase patterns.

**Scope:** Phase 1a — all providers in **manual mode**. LiTT generates
platform-native content, you approve, LiTT prepares ready-to-post output,
you post manually on each platform, LiTT records what was published.
No paid API calls. No scheduler. No autopilot. No analytics.

---

## Locked architecture decisions

| Decision | Resolution |
|---|---|
| Budget | **$0.** No paid social API spend. No new infrastructure. Build the machinery first. |
| Provider mode | Every provider has `mode: "manual" \| "api"`. Phase 1a: all providers `manual`. Flip to `api` later per-provider without redesign. |
| Phase 1a providers | **X, Reddit, HN, Product Hunt** — all manual. LiTT prepares content + a "open on platform" link; you post by hand; LiTT records the result. |
| Scheduler | **Phase 1b.** Supabase `pg_cron` + `pg_net` → `growth-dispatch` Edge Function. Not in 1a. |
| Secrets / Vault | **Deferred to API-mode (1b+).** Manual mode makes no authenticated API calls, so no OAuth tokens to store in 1a. `growth_accounts` table still created (with Vault ref columns, nullable) so the schema is forward-compatible, but no Vault secrets are written and no `growth_get_account_tokens` RPC is needed yet. |
| X pricing | Pay-per-use, no subscription, no minimum. Exact per-request prices are in the Developer Console and subject to change — **do not hard-depend on specific figures.** Not relevant in 1a (manual mode = $0). |
| Reliability | `growth_publications` still carries `idempotency_key` (prevents double-record). No `publishing`/`unknown` network-failure states in manual mode (no network call) — those states exist in the schema for 1b API mode but are not exercised in 1a. |
| Rate limits | `ProviderRateLimit` type exists in the interface for 1b. Manual mode returns no rate-limit info. Not exercised in 1a. |
| Audit | `agent_logs` with `metadata._type = "growth_*"`. Silent-fail. Matches existing tool pattern. |

---

## Codebase patterns this contract follows (verified)

- **Tool registry:** `src/lib/project-tools/registry.ts` — `ToolHandler = (userId, args) => Promise<ToolResult>`, `ToolMetadata { projectScoped, mutating, readOnly }`, `PROJECT_TOOLS` map, `executeProjectTool()`. `ok()/fail()` from `src/lib/vapi-tools.ts`.
- **Supabase admin:** `supabaseAdmin` proxy from `src/lib/supabase.ts` (service role, bypasses RLS, build-safe mock when key missing).
- **Auth:** `auth(req)` from `src/lib/auth.ts` → `{ userId: clerkId }`. Routes wrap handlers with `withRateLimit`.
- **Audit:** `agent_logs` table, `metadata._type` discriminator. Silent-fail inserts.
- **Schema migrations:** `supabase/migrations/YYYYMMDDHHMMSS_description.sql`, idempotent `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `service_role_all_*` policy, `TEXT user_id` for Clerk IDs.
- **Job queue precedent:** `browser_jobs` migration — `idempotency_key TEXT NOT NULL` + `CREATE UNIQUE INDEX`, status machine `CHECK`.
- **Provider registry precedent:** `src/lib/connectors/provider-registry.ts` — `ProviderDefinition`, capability IDs, status enums.
- **`pg_cron` precedent:** `supabase/schema.sql` already uses `cron.schedule(...)`.

---

## The provider mode interface (the key design point)

```ts
interface GrowthProvider {
  id: string;                          // "x" | "reddit" | "hackernews" | "producthunt"
  label: string;
  mode: "manual" | "api";              // 1a: always "manual"
  validate(): Promise<ProviderHealth>;  // manual: always healthy; api: checks token
  prepare(input: PrepareInput): Promise<PreparedPost>;
  // publish() only exists in api mode — not called in 1a
  publish?(input: PublishInput): Promise<PublishResult>;
  reconcile?(publication: Publication): Promise<ReconciliationResult>;
  delete?(id: string): Promise<void>;
  getMetrics?(id: string): Promise<PostMetrics>;
}
```

**Manual mode flow:**
1. `prepare()` returns a `PreparedPost` — the final text, a platform "compose" URL (e.g. `https://twitter.com/compose/post?text=...` for X, `https://www.reddit.com/submit?title=...&selftext=true` for Reddit, `https://news.ycombinator.com/submit` for HN, Product Hunt's submit page), and a `copyToClipboard` payload.
2. The user opens the link, pastes, posts by hand.
3. The user (or LiTT, if given the URL) calls `growth.mark_published` with the resulting `external_url`.
4. LiTT records `growth_publications.status = published` + the URL.

**Why this is forward-compatible:** flipping a provider from `manual` → `api` means implementing `publish()` and switching the mode flag. The campaign → content → approve → publication pipeline, the policy engine, the audit trail, and the DB schema are all identical. The only thing that changes is who makes the final HTTP request.

---

## File-by-file build contract — Phase 1a

### New files

#### `supabase/migrations/20260813180000_growth_engine_phase1a.sql`
New tables, all RLS-enabled with `service_role_all_*` policies, `TEXT user_id` for Clerk IDs:

- **`growth_accounts`** — one row per (user, provider). Forward-compatible with API mode.
  - `id uuid pk`, `user_id text not null`, `provider text not null check (provider in ('x','reddit','hackernews','producthunt'))`, `mode text not null default 'manual' check (mode in ('manual','api'))`, `provider_account_id text`, `provider_account_name text`, `access_token_secret_id uuid` (nullable, Vault ref — unused in 1a), `refresh_token_secret_id uuid` (nullable — unused in 1a), `token_expires_at timestamptz`, `scopes text[]`, `status text not null default 'active' check (status in ('active','expired','revoked','disconnected','needs_reauth'))`, `last_verified_at timestamptz`, `metadata jsonb default '{}'`, `created_at/updated_at timestamptz`. `UNIQUE(user_id, provider)`.

- **`growth_campaigns`** — a campaign = one event/announcement adapted per platform.
  - `id uuid pk`, `user_id text not null`, `name text not null`, `objective text` (e.g. 'launch','feature_update','announcement'), `event_summary text not null`, `target_providers text[] not null default '{x}'`, `status text not null default 'draft' check (status in ('draft','generating','active','completed','cancelled'))`, `metadata jsonb default '{}'`, `created_at/updated_at`.

- **`growth_content`** — platform-native drafts belonging to a campaign.
  - `id uuid pk`, `campaign_id uuid not null references growth_campaigns on delete cascade`, `user_id text not null`, `provider text not null`, `content text not null`, `content_type text not null default 'text'`, `media_urls text[]`, `status text not null default 'draft' check (status in ('draft','approved','rejected','published','archived'))`, `approved_by text`, `approved_at timestamptz`, `rejected_reason text`, `version int not null default 1`, `created_at/updated_at`. Index on `campaign_id`, `status`.

- **`growth_publications`** — the publication record (idempotent, forward-compatible with API mode).
  - `id uuid pk`, `campaign_id uuid references growth_campaigns on delete set null`, `content_id uuid references growth_content on delete set null`, `user_id text not null`, `provider text not null`, `provider_account_id text`, `idempotency_key text not null`, `provider_request_hash text`, `status text not null default 'draft' check (status in ('draft','approved','scheduled','publishing','published','retryable_failed','permanent_failed','unknown','cancelled'))`, `mode text not null default 'manual' check (mode in ('manual','api'))`, `scheduled_at timestamptz`, `claimed_at timestamptz`, `publishing_at timestamptz`, `published_at timestamptz`, `next_attempt_at timestamptz`, `attempt_count int not null default 0`, `max_attempts int not null default 3`, `external_id text`, `external_url text`, `last_http_status int`, `last_error text`, `last_error_code text`, `credits_charged numeric(10,4)`, `utm_campaign text`, `utm_source text`, `utm_medium text`, `created_at/updated_at`. `CREATE UNIQUE INDEX idx_growth_publications_idempotency ON growth_publications(idempotency_key)`.

- **`growth_rules`** — per-user/per-provider policy (cooldowns, daily caps).
  - `id uuid pk`, `user_id text not null`, `provider text not null`, `daily_post_limit int default 3`, `min_interval_minutes int default 60`, `cooldown_minutes int default 0`, `require_approval boolean default true`, `metadata jsonb default '{}'`, `UNIQUE(user_id, provider)`.

- **No `growth_get_account_tokens` RPC in 1a** — deferred to API mode. No Vault secrets written.

- **No `pg_cron` schedule in 1a** — deferred to 1b.

#### `src/lib/growth/types.ts`
All shared types: `GrowthProvider`, `PrepareInput`, `PreparedPost`, `PublishInput`, `PublishResult`, `ProviderHealth`, `ProviderRateLimit`, `Publication`, `PostMetrics`, `ReconciliationResult`, `CampaignObjective`, `ContentStatus`, `PublicationStatus`, `ProviderMode`. `PreparedPost` includes `text`, `composeUrl`, `clipboardPayload`, `platformLabel`.

#### `src/lib/growth/provider-registry.ts`
`GROWTH_PROVIDERS: Record<string, GrowthProvider>` — registry of provider instances. In 1a: `x`, `reddit`, `hackernews`, `producthunt`, all `mode: "manual"`. Exports `getProvider(name)`, `listProviders()`.

#### `src/lib/growth/providers/x-provider.ts`
`XProvider` — `mode: "manual"`. `prepare()` returns `PreparedPost` with:
- `text`: the approved content
- `composeUrl`: `https://twitter.com/compose/post?text=${encodeURIComponent(text)}`
- `clipboardPayload`: the raw text for copy-to-clipboard
- `platformLabel`: "X (Twitter)"
`validate()` returns healthy (manual mode). `publish()` not implemented.

#### `src/lib/growth/providers/reddit-provider.ts`
`RedditProvider` — `mode: "manual"`. `prepare()` returns `PreparedPost` with:
- `text`: the approved content (title + body split if needed)
- `composeUrl`: `https://www.reddit.com/submit?title=${encodeURIComponent(title)}&selftext=true`
- `platformLabel`: "Reddit"
Includes subreddit selection guidance in the prepared output (from `growth_rules.metadata.preferred_subreddits`).

#### `src/lib/growth/providers/hackernews-provider.ts`
`HackernewsProvider` — `mode: "manual"`. `prepare()` returns `PreparedPost` with:
- `text`: title + URL (Show HN format)
- `composeUrl`: `https://news.ycombinator.com/submit`
- `platformLabel`: "Hacker News"

#### `src/lib/growth/providers/producthunt-provider.ts`
`ProductHuntProvider` — `mode: "manual"`. `prepare()` returns `PreparedPost` with:
- `text`: tagline + description + maker comment
- `composeUrl`: Product Hunt submit page URL
- `platformLabel`: "Product Hunt"

#### `src/lib/growth/growth-repository.ts`
DB access layer (mirrors `connectors/connector-repository.ts`). All functions take `clerkId: string`. Uses `supabaseAdmin`. Functions: `createCampaign`, `getCampaign`, `listCampaigns`, `createContent`, `getContent`, `listDrafts`, `approveContent`, `rejectContent`, `rewriteContent` (new version, increments `version`), `createPublication`, `getPublicationByIdempotencyKey`, `markPublished` (sets `status='published'`, `published_at`, `external_url`, `external_id`), `markFailed`, `getRules`, `upsertRules`, `getAccount`, `upsertAccount`. No token values in 1a.

#### `src/lib/growth/content-engine.ts`
`generateContent(campaign, provider, rules)` — calls the LLM to produce platform-native content for one provider from the campaign `event_summary`. Returns `growth_content` rows (not yet persisted — the tool handler persists). Platform-specific guidance:
- **X:** punchy, hook + demo, ≤280 chars safe default, optional thread.
- **Reddit:** "I've been building this..." technical, ask for criticism, subreddit-appropriate.
- **HN:** "Show HN: <name> — <one-line>" format.
- **Product Hunt:** tagline + description + maker comment + first-comment strategy.
Enforces: no duplicate of existing approved content for the same campaign (string-similarity check; semantic dedup deferred to 1b). Uses existing LLM client pattern (OpenRouter via `OPENROUTER_API_KEY`).

#### `src/lib/growth/policy-engine.ts`
`enforcePrePublishRules(user_id, provider, content, rules)` — checks: daily post limit (count `published` today), min interval since last published, cooldown. Returns `{ allowed: boolean, reason?: string }`. Does NOT block draft generation. Called by `growth_mark_published` before recording (in manual mode, the policy check is a guardrail against the user over-posting, not an API gate).

#### `src/lib/growth/utm.ts`
`buildUtmUrl(baseUrl, { campaign, source, medium })` — generates UTM-tagged URLs for inclusion in prepared content. `utm_source` = provider name, `utm_medium` = "social", `utm_campaign` = campaign slug. Stored on `growth_publications` for later attribution (Phase 2).

#### `src/lib/growth/audit.ts`
`auditGrowthAction({ userId, action, campaignId, publicationId, provider, success, error, durationMs })` — inserts into `agent_logs` with `metadata._type = "growth_publication"` (or `"growth_campaign"`, `"growth_content"`). Silent-fail. Never logs full content bodies (only content_id reference + length).

#### `src/lib/project-tools/growth-handlers.ts`
The six `growth.*` tool handlers, each `ToolHandler = (userId, args) => Promise<ToolResult>`:
- `growth_create_campaign` — `{ name, objective, event_summary, target_providers? }` → creates campaign, returns `campaignId`. `metadata: { projectScoped: false, mutating: true, readOnly: false }`.
- `growth_generate_content` — `{ campaign_id, provider }` → calls `content-engine.generateContent`, persists drafts, returns draft IDs + previews. `projectScoped: false, mutating: true`.
- `growth_list_drafts` — `{ campaign_id?, provider?, status? }` → returns drafts. `readOnly: true`.
- `growth_rewrite_post` — `{ content_id, instructions }` → creates new version, returns new draft. `mutating: true`.
- `growth_approve_post` — `{ content_id }` → transitions `draft → approved`. `mutating: true`.
- `growth_mark_published` — `{ content_id, external_url, external_id? }` → enforces policy, creates `growth_publications` row with `idempotency_key`, calls `provider.prepare()` to generate the compose URL (if not already prepared), transitions to `published` with the user-supplied `external_url`. Returns the recorded publication. `mutating: true`.

**Note on `growth_publish_post` → `growth_mark_published`:** In manual mode there is no "publish" action LiTT performs — the user posts by hand. The tool records what the user reports as published. The name change from `publish` to `mark_published` reflects this honestly (per `LITT_BEHAVIOR_CONTRACT` rule 1: never claim an action happened unless the tool returned success).

#### `src/lib/vapi-tool-definitions.ts` (edit — append)
Add six `growth_*` entries to `VAPI_TOOL_DEFINITIONS` with `ParameterSchema`. Add the six names to `TOOL_NAMES` in `vapi-tools.ts`.

#### `src/lib/project-tools/registry.ts` (edit — append)
Import the six handlers from `growth-handlers.ts`; append six entries to `PROJECT_TOOLS` map with correct `ToolMetadata`.

#### `src/app/api/growth/campaigns/route.ts` and `[campaignId]/route.ts`
REST wrappers for the repository (for Studio UI + testing). `auth(req)` + `withRateLimit`.

#### `src/app/api/growth/content/[contentId]/route.ts`
GET content, PATCH (approve/reject/rewrite). `auth(req)` + `withRateLimit`.

### Files NOT touched in 1a (explicitly deferred)
- No `growth-dispatch` Edge Function (1b).
- No `pg_cron` schedule (1b).
- No `growth_schedules` table (1b).
- No `growth_get_account_tokens` RPC (API mode, 1b+).
- No Vault secrets written (API mode, 1b+).
- No OAuth callback routes (API mode, 1b+).
- No `publish()` implementation on any provider (API mode, 1b+).
- No analytics tables `growth_metrics`, `growth_experiments` (Phase 2).
- No `growth.recommend_*` tools (Phase 2).

---

## End-to-end 1a flow (the thing that must work before 1b)

```
LiTT intent ("post about the new Canvas feature")
  → growth_create_campaign  → growth_campaigns row (status=draft)
  → growth_generate_content → content-engine → growth_content rows (one per provider)
  → [human] reviews drafts via growth_list_drafts
  → [human] growth_approve_post → content.status=approved
  → growth_mark_published
       → provider.prepare() → PreparedPost { text, composeUrl, clipboardPayload }
       → LiTT tells the user: "Your X post is ready. Opening compose..."
       → user clicks composeUrl, pastes, posts on X by hand
       → user tells LiTT the post URL (or LiTT asks for it)
       → growth_mark_published { content_id, external_url } 
       → policy-engine.enforcePrePublishRules (daily cap, interval)
       → create growth_publications (idempotency_key, status=published, external_url)
       → auditGrowthAction → agent_logs
  → truthful ToolResult back to LiTT
```

---

## Required env vars (1a)

- Existing only: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `OPENROUTER_API_KEY`, `LITTLABS_VAPI_TOOL_TOKEN`, `LITTLABS_VAPI_OWNER_CLERK_ID`.
- **No new env vars.** No `X_CLIENT_ID`, no `X_CLIENT_SECRET`, no Vault extension needed yet.

---

## Verification gate (before 1b)

1. `pnpm exec tsc --noEmit` clean.
2. `pnpm run lint` clean.
3. `pnpm run build` clean.
4. Unit tests for `policy-engine` (daily cap, interval) and `growth-repository` idempotency (duplicate `idempotency_key` rejected).
5. Unit tests for each provider's `prepare()` — compose URL is correctly encoded, clipboard payload matches content.
6. Manual: create campaign → generate content for X + Reddit → approve → mark_published → confirm `growth_publications.status=published` + `external_url` recorded + `agent_logs` row + no token in any log (there are no tokens).
7. Manual: verify compose URLs open the correct platform compose/submit pages with content pre-filled.
