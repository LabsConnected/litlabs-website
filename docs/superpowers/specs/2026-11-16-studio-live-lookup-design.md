# Studio Live Lookup Engine — Design

Date: 2026-11-16
Branch: `worktree-studio-live-lookup`
Status: Approved by Larry (2026-11-16), implemented — PR open, pending LiTT's review and merge

## Problem

Studio chat refuses simple live-data questions such as "What time does Best
Buy open?" with a canned "I can't look up specific store hours" style
answer. There is no server-side engine that resolves business/place hours,
and the Studio board has no "Browser" panel surfaced for lookup results.

A general web-search tool chain already exists and is wired into Studio
chat's pre-LLM tool-intent router
(`src/lib/litt-intelligence/tool-executor.ts` → `web-search-tool.ts`, Brave
Search with a keyless DuckDuckGo fallback). The gap is specifically
**place/business hours** lookups: `src/lib/connectors/provider-registry.ts`
already *declares* a `places.search` capability, but nothing implements it,
and chat has no hook for it.

## Goals

- Add a places/hours lookup tool that resolves "what time does X open/close"
  style questions with a sourced, structured answer (name, address, hours,
  source).
- Route such questions (and other simple factual lookups) to this tool
  instead of falling through to an LLM guess or refusal.
- Surface the same engine on a new Studio board "Browser" panel, showing
  real lookup results only (no placeholder/fake rows).
- Keys sourced from env only; never commit or print a key.

## Non-goals / explicit exclusions

- No changes to `src/app/api/studio/conversations/[conversationId]/messages/route.ts`'s
  approval-gate sections, `quality-loop.ts`, `quality-loop-flow.ts`,
  `launch-flow.ts`, or `src/lib/litt-kernel/intent-router.ts` — PR #1016's
  territory this week.
- No Stripe/Clerk/GitHub secrets, logo assets, or sandbox-executor files.
- No new Railway service; ships inside the existing web app.
- No changes to the Inspector's existing "Browser" tab
  (`StudioBrowserJobsPanel`) — that panel is being repurposed separately and
  is out of scope here.
- No duplication of the existing Brave/DuckDuckGo web-search chain.

## Architecture

### 0. Correction to the declared `places.search` capability

`src/lib/connectors/provider-registry.ts` already declares the
`places.search` capability, but its `provider` field points at
`brave_search` — a provider that never implemented it. Since this plan
implements `places.search` via Google Places, the registry's mapping is
corrected as part of this work: a new `google_places` `PlatformProvider`
entry is added (`envVars: ["GOOGLE_PLACES_API_KEY"]`), `places.search` is
removed from `brave_search`'s capability list, and
`CAPABILITY_DEFINITIONS["places.search"].provider` is repointed at
`"google_places"`. This is a small, directly-necessary fix to a stale
mapping, not unrelated refactoring — the existing
`provider-registry.test.ts` assertion that `places.search` belongs to
`brave_search` is updated accordingly.

### 1. Places provider + tool (new files, existing pattern)

`src/lib/litt-intelligence/places-provider.ts`:
- `getApiKey()` → `process.env.GOOGLE_PLACES_API_KEY ?? null`
- `isPlacesAvailable()` → key presence check
- `searchPlace(query: string)` → calls Google Places Text Search + Place
  Details, returns `{ name, address, openNow, hours, mapsUrl } | null`

`src/lib/litt-intelligence/places-tool.ts`:
- Wraps the provider; on no key configured, returns an honest "I don't have
  a configured place lookup right now" message (never guesses).
- On a result, formats a sourced reply, e.g. "Best Buy on Main St is open
  until 9pm today. Source: Google Places."
- Calls `recordToolCall()` for audit, mirroring `weather-tool.ts`.

No new search-provider code is added — generic factual questions continue
to use the existing `web-search-tool.ts` (Brave → DuckDuckGo) unchanged.

### 2. Routing wiring

`src/lib/litt-intelligence/tool-executor.ts`:
- Add `ToolId = "places"` to the union.
- Add `detectPlacesIntent(message)`: business-name + hours/open/close
  keyword patterns (e.g. "what time does X open/close", "is X open now",
  "X hours").
- In `detectAndExecuteTool`, check places intent before falling through to
  `web_search`/LLM, mirroring the existing weather/web-search ordering.
- Verify `detectWebSearchIntent` already covers generic factual questions
  that aren't place-specific; extend its patterns only if a gap is found
  during testing (minimal, targeted change, not a rewrite).

`src/lib/litt-intelligence/runtime-context-injector.ts`:
- Add a `places` entry to `buildToolManifest()` next to `weather` /
  `web_search`, with the same "must call the tool before answering"
  live-data rule.

`src/lib/env.ts`:
- Add `GOOGLE_PLACES_API_KEY: z.string().optional()` to
  `optionalIntegrationSchema`.

### 3. Extend the existing Studio board "Browser" panel

**Correction (2026-11-16, after implementation research):** the board's
"Browser" panel already exists — `BoardPanelId` already includes
`"browser"`, `BOARD_PANEL_INVENTORY` already has an entry for it, and
`BoardPanelBindings.tsx` already has a `case "browser"` mounting
`BoardBrowserPanel.tsx` (a real address-bar-driven iframe browser). That
component's own header comment already flags "wiring LiTT's own web
lookup through this panel" as an explicit next step. No new `BoardPanelId`,
inventory entry, or binding case is added — only `BoardBrowserPanel.tsx`'s
contents are extended.

`src/app/(app)/studio/components/board/BoardBrowserPanel.tsx`:
- Add a lookup bar (separate from the existing URL address bar) that posts
  a query to the new `/api/studio/lookup` route via `useLiveLookup` and
  renders the real, sourced result or an honest error. No placeholder/fake
  result is ever shown — the result/error blocks only render when the
  server actually returned one.

`src/app/api/studio/lookup/route.ts` (new):
- `POST { query }` → runs `places-tool`/`web-search-tool` logic server-side
  (same functions chat uses), returns the structured sourced result as
  JSON. Same auth/session convention as `src/app/api/studio/browser/route.ts`.

`src/app/(app)/studio/hooks/useLiveLookup.ts` (new):
- Mirrors `useBrowserJobs.ts`'s shape: `{ result, loading, error, search(query) }`,
  calling the new route. No polling needed (lookup is request/response, not
  a long-running job).

## Data flow

1. User asks "What time does Best Buy open?" in Studio chat.
2. `messages/route.ts` step "7.6" calls `detectAndExecuteTool`.
3. `detectPlacesIntent` matches → `executePlacesTool` calls
   `places-tool.ts` → `places-provider.ts` → Google Places.
4. The tool's sourced text is persisted as the assistant message and
   streamed back over SSE. The LLM is never called for this turn.
5. Independently, if the user opens the board's existing "Browser" panel
   (`BoardBrowserPanel.tsx`) and types a query into its lookup bar,
   `useLiveLookup` POSTs to `/api/studio/lookup`, which calls the same
   `places-tool`/`web-search-tool` functions and returns the same
   structured, sourced result.

Both surfaces call the same underlying tool functions — no divergent logic
path, no duplicated provider code.

## Error handling

- No `GOOGLE_PLACES_API_KEY` configured → tool returns an explicit "lookup
  not configured" message; chat relays it verbatim; the board panel shows
  the same honest message, not a fake/placeholder result.
- Places API call fails (network/4xx/5xx) → tool catches, logs, returns an
  honest "couldn't complete that lookup" message; never fabricates hours.
- No place found for the query → tool returns "couldn't find a match for
  that query" rather than guessing.

## Testing

- `places-provider.test.ts` — mocked `fetch`, covers found/not-found/HTTP
  error cases.
- `places-tool.test.ts` — mocked provider, covers found / not-found / no-key
  paths and exact message formatting.
- `tool-executor` routing test — "What time does Best Buy open?" routes to
  the places tool; asserts the LLM generation path is never invoked.
- Manifest test — `places` appears in `buildToolManifest()`'s output.
- `BoardBrowserPanel.test.tsx` — asserts no placeholder content renders
  when there are no results yet, and that a real lookup renders the
  genuine sourced result or an honest error.

PR-body transcript: produced from the mocked-provider test output, labeled
explicitly as a test-harness run (no live `BRAVE_SEARCH_API_KEY` /
`GOOGLE_PLACES_API_KEY` available in this environment). Larry will add real
keys to the Railway environment and verify live after review.

## Verification before PR

- `pnpm exec tsc --noEmit`
- `pnpm exec vitest run` (full suite, or at minimum the affected test files
  plus a full run to catch regressions)
- Manual read-through confirming no edits touched the excluded files listed
  under Non-goals.
