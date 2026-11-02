# LiTT Production Launch Checklist — 2026-11-02

Single evidence-based checklist. Every item cites the evidence that produced
it. Supersedes the remaining-open items in `MISSION-STATE.md`,
`e2e-live/MISSION-REPORT.md`, and `TODO.md` where marked.

## Reconciled state (verified 2026-11-02 ~14:30 UTC)

| Item | State | Evidence |
| --- | --- | --- |
| Canonical `main` | `5cf90d3f` — includes PRs #765 (modify-step repair, real ZIP export, terminal ownership, tasks-403), #766, #758 | `git log origin/main` |
| Production web | **`5cf90d3f` — at main HEAD**, all health checks ok (env, build, database, storage, auth) | `GET https://www.litlabs.net/api/health` |
| Production terminal-server | `5cf90d3f`, uptime ~20h, readiness ready; **terminal exec DISABLED, fail-closed** (no Docker, no verified sandbox) — file/checkpoint transport healthy | `GET https://terminal.litlabs.net/health` |
| Second terminal deployment | `terminal-server-production-68ac` at `41857567` (stale, pre-#758) | `GET …68ac…/health` — decommission or redeploy, see item 9 |
| Canonical checkout (native) | `main`, clean, synced | `/data/data/com.termux/files/home/litt-canonical` |
| Proot clone `/root/litt-canonical` | secondary clone on merged branch `feat/studio-stabilization-20261029`, clean | NOTICE-NON-CANONICAL.md |
| PC dev host (LITREECEO) | **UNREACHABLE** — ssh :2222 timeout, tailnet ping 100% loss (asleep or Tailscale down) | `pc status`, `ping 100.107.123.73` |
| Railway CLI auth | token **expired** — `railway whoami` → Unauthorized | `~/.railway/config.json` |
| GitHub `RAILWAY_TOKEN` secret | exists (deploy-terminal.yml) — usable via workflow_dispatch | `.github/workflows/deploy-terminal.yml` |
| Production AI | **ALL ROUTES DEAD** — see P0-1 | golden run 41356016210 SSE artifact |
| Phone Ollama (dex) | DOWN, tuned env intact, models present per tune/ dir | `dex-ctl status` |

## P0 — Launch blockers

### P0-1. Production AI: no working provider  ← THE blocker

Golden acceptance run `41356016210` (2026-11-01) — real production SSE:

```
model_failed: all-routes / all_fallbacks_exhausted
Attempts: openrouter/nvidia/nemotron-3-super-120b-a12b:free → auth_invalid http_401
Excluded: gemini(gemini_disabled_by_config), groq(credential_missing),
          mistral(credential_missing), cloudflare(credential_missing),
          ollama(not_deployed), byok(user_funded_requires_user_key)
```

- `OPENROUTER_API_KEY` in Railway is invalid/revoked (401 at call time).
- `GEMINI_DISABLED=true` is set deliberately (billing depleted, HTTP 402).
- Fix = **credentials**: a valid `OPENROUTER_API_KEY`, or `GROQ_API_KEY` /
  `MISTRAL_API_KEY` / Cloudflare, or re-enable Gemini with billing — set as
  Railway variables on the `web` service. No code change needed; routing,
  honest failure, and per-route exclusion already work.
- Owner action required (secret material + Railway access). Alternative:
  add the key as a GitHub secret and use a workflow_dispatch step
  (`railway variable set`) — token already exists.
- Verify: `GET /api/llm/health` (authed) `basicRoutes` shows a non-excluded
  route; golden journey `provider_response_evidence` + `files_written` pass.
- `/api/llm/health` unauthenticated `status` reports key-presence, not
  call-validity — it said `ok` while OpenRouter was 401. Accepted cosmetic
  gap; authenticated `basicRoutes` is the real signal.

### P0-2. PC dev host offline — local acceptance + PC terminal fix verification gated

- `pc status` → ssh timeout; tailnet ping dead. Needed for: dev-server
  acceptance (e2e-live specs), Ollama local lane, PC terminal-server
  restart verification.
- **Mitigation shipped in PR #767**: terminal-server no longer dies when
  the node-pty binding is absent — the PC crash-loop root cause is fixed
  in code and verified on a binding-less host. `scripts/terminal-supervisor.mjs`
  adds bounded restarts + health gate (replaces the ad-hoc `.cmd` loop).
- Without the PC, production acceptance runs via
  `final-acceptance-golden.yml` (GitHub-hosted Playwright, disposable
  Clerk users, real prod) — already wired.

### P0-3. Old terminal deployment at stale SHA

- `terminal-server-production-68ac` serves `41857567` and is still listed
  in the web CSP frame-src. Either it's a live duplicate (split-brain
  fingerprint: different secretSha/serviceKeySha/workspaceRoot) or stale.
- Action: confirm which service `TERMINAL_SERVER_INTERNAL_URL` points to
  on the `web` service, remove the other from CSP in `next.config.ts`,
  decommission the stale one.

## P1 — Required for launch verdict

4. **10 consecutive acceptance runs** — vehicle: `final-acceptance-golden.yml`
   ×10 (prod) and/or `e2e-live/studio-live.spec.ts` ×10 (PC dev). Acceptance
   means REAL generation: files_written + provider evidence + preview +
   modify + reload persistence + export ZIP. Golden covers all but export;
   verify export separately (`GET /api/studio-projects/[id]/export` shipped
   in #765, unit-tested).
   *Gated on P0-1.*
5. **PR #763** brand refresh — 1/7 checks failing; rebase or close.
6. **PR backlog triage** (#713–#764): ~40 open PRs. Several CI-green and
   mergeable (#760, #761, #755, #756, #759, #754); three CONFLICTING
   (#764, #753, #752 — #752's production hold was superseded by the
   manual-dispatch deploy gate that already shipped).
7. **Merge + deploy PR #767** (terminal lazy-pty + supervisor). Railway
   GitHub auto-deploy picks it up on merge (both web and terminal services
   already ride main; deploy-terminal.yml is a manual-only belt).
8. **Production smoke after provider fix**: sign-in → build → modify →
   export on production; watch SSE for a non-excluded route actually
   completing.

## P2 — Post-launch / noted debt

9. **Dedicated sandbox runtime** for customer terminal exec — prod
   correctly refuses host PTY today (fail-closed). Options: E2B / Fly
   Machines / dedicated VM running `littree-terminal` with Docker.
   TODO.md "Production Runtime (BLOCKED)" is now *partially outdated* —
   the server is deployed and healthy; only interactive exec is gated.
10. **Ghost /cancel** — instrumentation + cancel-repro.spec merged (#765);
    no ghost cancel observed in later runs. Keep instrumentation; revisit
    only if it recurs.
11. **1.5B small-lane fidelity** — heading ~30%, theme ~10–20%; lane stays
    behind `LITT_LOCAL_SMALL`; `litt-hermes:16k` remains Studio default.
    Closed as "not achievable at this model size" per MISSION-REPORT.
12. **Quality-gate marker check** (unconfirmed) — superseded: the small
    lane + #765 modify-step repair passed acceptance without the marker
    requirement blocking; treat as resolved unless it recurs.
13. **Voice / LiveKit** — terminal-server image also runs the voice
    worker (`railway.worker.json`, `/health/live`). Voice integration
    defects: none verified yet this cycle — spot-check in Phase 5.
14. **Stale mission docs** — `MISSION-STATE.md` / `e2e-live/MISSION-REPORT.md`
    describe the Oct-31 mission; retain as history, do not reopen without
    regression proof. This checklist is the current truth.

## Deployment facts (from docs/ENVIRONMENTS.md + workflows, verified)

- Prod = Railway project `litlabs-terminal-server`, service `web`,
  `https://www.litlabs.net`, deployed from `main`.
- `NEXT_PUBLIC_TERMINAL_HTTP_URL`, `NEXT_PUBLIC_TERMINAL_WS_URL`,
  `TERMINAL_SERVER_INTERNAL_URL` explicitly set on prod `web`.
- Rollback target: previous green deploy = `41857567` (PR #765) — or
  redeploy any earlier green `main` SHA via Railway.
- `release-gate.yml` health-checks prod hourly (last 5 runs all green).
- `deploy-terminal.yml` is manual-dispatch only (production gate);
  `PRODUCTION_DEPLOY_HOLD` release-gate behavior lives in
  release-gate.yml (PR #752 context).
