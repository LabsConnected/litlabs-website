# Playwright MCP — QA Lane Runbook

Agent-operated browser testing for LiTT. This complements (does not replace)
the scripted suites: `pnpm test:e2e` stays the blocking CI gate; the MCP server
lets QA lane agents **independently navigate and test** a live preview the way
a user would, then file reproducible bug reports.

## Quickstart (Codex lane)

```bash
# 1. Register the server, pointed at the isolated preview under test.
#    The wrapper REFUSES to start against production — fail-closed.
codex mcp add playwright-qa \
  --env QA_TARGET_URL=https://<preview-name>.up.railway.app \
  -- /home/hatch/workspace/litlabs-website/tools/qa/qa-browser.sh

# 2. Verify registration.
codex mcp list   # playwright-qa should appear as enabled

# 3. Smoke-test the stack (no browser target needed):
node tools/qa/verify-mcp.mjs   # expect VERIFY-MCP: ALL PASS
```

After this PR merges, re-register with the canonical path above (any worktree
path used during review must be replaced).

## How production is protected (in code, not instructions)

Every MCP entry point (Codex CLI, Cursor, VS Code) launches through
`tools/qa/qa-launch.mjs` (`tools/qa/qa-browser.sh` is a thin shim over it for
the shell-based entries). Protection layers:

1. **Target validation** (launcher): `QA_TARGET_URL` must be `localhost`,
   `127.0.0.1`, or `*.up.railway.app`. Production hosts (`litlabs.net`,
   `www.litlabs.net`, `app.litlabs.net`, `web-production-d3a22.up.railway.app`)
   are refused outright, exit 2.
2. **Redirect pre-check**: the full redirect chain is resolved with curl before
   launch; if the final host is production (or outside the allowlist), launch
   is refused. Covers chains like preview -> apex -> www.
3. **Network-layer guard** (`tools/qa/qa-guard-proxy.mjs`, wired via the MCP
   server's `--proxy-server`): every browser request to `litlabs.net` /
   `www.litlabs.net` — initial navigation, any redirect hop, or an agent's
   `browser_navigate` — gets a 403. Playwright MCP's own
   `--allowed-origins`/`--blocked-origins` flags explicitly "do not serve as a
   security boundary and do not affect redirects", so they are only
   defense-in-depth here.
4. **Isolated browser profile** (`--isolated`): nothing persists between runs;
   no cookie/state leaks across QA sessions.
5. **Destructive tests run ONLY on isolated preview environments** (Railway
   PR/preview deploys). Production gets read-only smoke via the existing manual
   `prod-clerk-auth-smoke.yml` workflow — never this server.

Auth for QA sessions reuses the disposable-Clerk-user pattern from
`scripts/final-acceptance/` (fresh user per run, never reused). No production
credentials in MCP config, no `service_role` keys near the QA lane.

## The five charters

Work each charter against the preview named in `QA_TARGET_URL`. Record the
preview's commit SHA (`/api/health`) in every report.

1. **Authentication** — sign-up, sign-in, sign-out, session expiry, protected
   routes while signed out (expect redirects, not data), Clerk error states.
2. **Navigation** — every top-level route renders without console errors;
   back/forward, deep links, 404 behavior. Desktop + 390px viewport.
3. **App Builder** — start a build from a prompt, watch streaming progress,
   preview the result, approve/publish flow on the preview env.
4. **Creative Studio** — image/music/video surfaces: generate, history,
   error states when providers are unavailable.
5. **AI workflows** — Global LiTT chat: send, stream, tool calls, cost/usage
   attribution. Flag hallucinations and repeats (known: phone assistant
   "repeats a lot on some shit" — check whether Studio does too).

## Artifacts

- Screenshots / videos / traces: `QA_ARTIFACT_DIR` (default
  `./test-results/qa-mcp`), one subdir per run named `<date>-<charter>`.
- Name files descriptively: `studio-build-streaming-stuck.png`, not `img1.png`.

## Bug report template

File one report per defect; reconcile into the ONE master finish board
(`FINISH_BOARD.md`), not a separate pile.

```
Title: [P1] Studio preview pane goes blank after second build
Preview: https://<preview>.up.railway.app @ <commit SHA>
Severity: P1 (P0 = data loss / security / crash loop; P1 = broken core flow;
          P2 = degraded / workaround exists; P3 = polish)
Repro:
  1. Sign in as disposable QA user <id>
  2. ...
Expected: ...
Actual: ...
Evidence: <screenshot/video path>, console errors (paste), network failures
Suspected area: <component/route, if known>
```

## Verification status

- `tools/qa/verify-mcp.mjs`: MCP handshake, 25 tools listed, browser proven
  working before AND after the block probes (no false positives), production
  navigations to `www.litlabs.net` and `app.litlabs.net` blocked at the
  network layer — ALL PASS (2026-10-08, @playwright/mcp@0.0.83).
- Launcher refusal paths (no target / prod hosts / random host /
  redirect-to-prod chain): all refuse with exit 2 — verified 2026-10-08.
- Executable bit set via `git update-index --chmod=+x` (verified in the
  committed tree with `git ls-files -s`).
- Codex CLI registration: this runbook's quickstart; interactive agent-driven
  browse verified before the Claude lane is added (per owner order).
