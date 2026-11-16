# Task 3 Report: places-provider.ts (Google Places client)

**Status:** DONE_WITH_CONCERNS (one deviation from the brief's test file, see below)
**Commit:** dfa9cb54c feat(litt-intelligence): add Google Places provider for business hours lookups

## What was implemented

- `src/lib/litt-intelligence/places-provider.ts`: exports `PlaceHours`, `isPlacesAvailable()`, `searchPlace(query)`, `formatPlaceResult(place)`. Implementation is verbatim from the brief. It mirrors the `weather-provider.ts` style (`import "server-only"`, module-level URL constants, JSDoc header with capability name).
- `src/lib/litt-intelligence/places-provider.test.ts`: brief's test file, with one type-only fix (see Deviations).

## TDD evidence

RED (before implementation file existed):

    $ pnpm exec vitest run src/lib/litt-intelligence/places-provider.test.ts
    FAIL src/lib/litt-intelligence/places-provider.test.ts
    Error: Failed to resolve import "./places-provider" from "src/lib/litt-intelligence/places-provider.test.ts". Does the file exist?
    Test Files  1 failed (1)   Tests  no tests

Note: the brief expected the message "Cannot find module". Vite's import-analysis plugin emits "Failed to resolve import" instead. Same root cause (module missing), so this is the RED state.

GREEN (after implementation):

    $ pnpm exec vitest run src/lib/litt-intelligence/places-provider.test.ts
    ✓ src/lib/litt-intelligence/places-provider.test.ts (6 tests)
    Test Files  1 passed (1)   Tests  6 passed (6)

Test cases (6): isPlacesAvailable true/false; searchPlace returns hours+address; null on ZERO_RESULTS; throws when key missing; throws on text-search HTTP 500.

Typecheck: `pnpm exec tsc --noEmit` exit 0, zero errors.

## Deviations

- Test file line 25: `let fetchSpy: ReturnType<typeof vi.spyOn>;` failed `tsc --noEmit` (TS2322, MockInstance type mismatch against `fetch`). Changed to `let fetchSpy: MockInstance<typeof fetch>;` with `type MockInstance` added to the vitest import. No runtime behavior change. Without this, the project typecheck (AGENTS.md verification step) fails.

## Self-review

- Completeness: all four exports from the brief present with the specified signatures. All brief test cases present.
- Quality: matches weather-provider.ts conventions. No new dependencies. Only the two specified files touched.
- Output: vitest prints "The CJS build of Vite's Node API is deprecated" on every run. This is toolchain noise from the environment, not test output, and is not caused by this change. No test warnings or stderr from the code under test.

## Concerns

- `formatPlaceResult` has no test coverage. The brief's test file does not exercise it. Later tasks (4, 6) consume it, so it may be worth a test there.
- `searchPlace` and `formatPlaceResult` are not exercised for the details-failure branch (`Place details failed`) or the `status !== "OK"` details branch. Covered by the brief's spec only indirectly.
- `formatPlaceResult` uses `toLocaleDateString("en-US")` against the server's local timezone, so "today" may differ from the place's timezone. Acceptable for this brief; flagging only.

## Fix round 1 (review finding: non-OK error statuses returned null)

**Problem:** `searchPlace` treated every non-"OK" Google `status` as "no match" and returned `null`. Google returns HTTP 200 with `REQUEST_DENIED`, `OVER_QUERY_LIMIT`, `INVALID_REQUEST`, or `UNKNOWN_ERROR` for bad/disabled keys, quota exhaustion, and malformed requests. These were silently reported as "not found."

**Change:** `places-provider.ts` adds a `PLACES_ERROR_STATUSES` set. Both the text-search and details status checks now throw `Places search failed: <status>` / `Place details failed: <status>` for those four statuses. `ZERO_RESULTS` and the OK-but-empty case still return `null`.

**Tests added (places-provider.test.ts):**
- text search returns `REQUEST_DENIED` -> throws `Places search failed: REQUEST_DENIED`
- text search OK with one result, details returns `OVER_QUERY_LIMIT` -> throws `Place details failed: OVER_QUERY_LIMIT`

**Command:** `pnpm exec vitest run src/lib/litt-intelligence/places-provider.test.ts`

**Output:**
    ✓ src/lib/litt-intelligence/places-provider.test.ts (8 tests)
    Test Files  1 passed (1)   Tests  8 passed (8)
    exit 0

**Typecheck:** `pnpm exec tsc --noEmit` (see fix-round result in the commit reply).

**Note:** The fix and the new tests were written in the same round, so I did not capture a separate RED run for the new cases against the pre-fix code.
