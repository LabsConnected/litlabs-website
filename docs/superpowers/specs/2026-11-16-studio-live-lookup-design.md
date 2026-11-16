# Studio Live Lookup Engine — Design

Date: 2026-11-16
Branch: `worktree-studio-live-lookup`
Status: Approved by Larry (2026-11-16), implementation in progress

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

### 3. New Studio board "Browser" panel

`src/app/(app)/studio/components/board/board-types.ts`:
- Add `"browser"` to `BoardPanelId`.
- Add an inventory entry following the `media`/`world` "honest slot"
  convention (empty state text when there's no query yet, no fake rows).

`src/app/(app)/studio/components/board/BoardPanelBindings.tsx`:
- Add a case for `"browser"` mounting a new `LiveLookupPanel` component.

`src/app/(app)/studio/components/board/LiveLookupPanel.tsx` (new):
- A simple query input + result card, rendering the sourced result or an
  honest empty/error state. No placeholder/fake activity rows ever.

`src/app/api/studio/lookup/route.ts` (new):
- `POST { query }` → runs `places-tool`/`web-search-tool` logic server-side
  (same functions chat uses), returns the structured sourced result as
  JSON. Same auth/session convention as `src/app/api/studio/browser/route.ts`.

`src/app/(app)/studio/hooks/useLiveLookup.ts` (new):
- Mirrors `useBrowserJobs.ts`'s shape: `{ result, loading, error, search(query) }`,
  calling the new route. No polling needed (lookup is request/response, not
  a long-running job).

`useBoardLayoutStore.ts`: register the new panel id so it can be added to a
board layout, following the existing registration pattern for other panels.

## Data flow

1. User asks "What time does Best Buy open?" in Studio chat.
2. `messages/route.ts` step "7.6" calls `detectAndExecuteTool`.
3. `detectPlacesIntent` matches → `executePlacesTool` calls
   `places-tool.ts` → `places-provider.ts` → Google Places.
4. The tool's sourced text is persisted as the assistant message and
   streamed back over SSE. The LLM is never called for this turn.
5. Independently, if the user opens the new "Browser" board panel and types
   a query, `LiveLookupPanel` calls `useLiveLookup`, which POSTs to
   `/api/studio/lookup`, which calls the same `places-tool`/`web-search-tool`
   functions and returns the same structured, sourced result.

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
- `LiveLookupPanel` / `BoardPanelBindings` test mirroring
  `BoardPanelBindings.test.tsx`'s existing pattern, asserting no
  placeholder content renders when there are no results yet.

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
