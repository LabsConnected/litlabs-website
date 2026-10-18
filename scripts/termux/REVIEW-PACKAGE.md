# LiTT Phone Setup — Independent Review Package

Date: 2026-10-17. Reviewer scope: verify claims below against the cited
evidence, then decide the single approval question at the bottom.

## What this branch contains

- `1070ff0d` — verbatim baseline of installed `~/bin/litt-menu` (was
  unversioned; committed so changes are reviewable diffs).
- `0e6e67de` — litt-menu v2 delta (the only functional change proposed):
  Dex submenu labels corrected for the live Fast2 default
  (`dex` = FAST2 1.7B routed tools; `dex full` = 4B escape),
  `dex voice` entry, Railway item (CLI presence + consent-gated
  `railway whoami`), Integrations item (n8n/trigger.dev honest
  UNAVAILABLE + voice capability lines), `h` = LiTT Home preview
  launcher, digits-only keys preserved (Health/Logs/Recovery → 9/10/11).
- `d45d02e5` — versioned backup of `~/bin` helper scripts
  (litt-capture/inbox/last/note/local-ai, phone-*, devin, hermes-*,
  rish). Scanned: zero secrets. `rish_shizuku.dex` binary excluded.

**Nothing is installed. `~/bin`, `$PREFIX/bin/dex`, `agent.py`, Ollama
env, and Android settings are all untouched by this branch.**

## Verified environment state (evidence)

- **Deployed Dex = Fast2, active default.** `sha256($PREFIX/bin/dex)`
  = `a788b627…` == staged `tune/dex.fast2-default`; `sha256(agent.py)`
  = `6b95665a…` == `agent-v1.19-fast2.py`. `dex full` remains the 4B
  path. Rollback: `tune/restore.sh` (sha256-verified) or the
  `backups-20261017-1630/*.pre-fast2-*` copies.
- **Security audit**: `tune/audit-v119-output-20261017.txt` — 93 passed,
  0 failed (provenance, safe_path, check_command, confirm gates, schema,
  rescue parser, fast2 routing, brain persistence, error handling).
- **Live tool routing**: `tune/probe-results.jsonl` — fast2 payload
  ~883–1017 tok vs full ~2517 tok; warm turns ~3–6s; `phone_battery`,
  `run_command`, `remember`, `phone_sms_send` all routed correctly.
- **phone_sms_send ordering proven** (offline dispatch probe, `_termux`
  stubbed): invented number → refused before confirm; real number in
  user text → confirm asked; decline → no send; only gate-passed calls
  reach `termux-sms-send`. SMS bodies redacted in audit.log.
  Sent-folder: latest real SMS predates this session — zero dispatched.
- **Journey** `tune/journey-results.jsonl`: 13/14. The one fail is a
  generation-quality quirk — the 1.7B verbalized "purple thunder 47"
  but omitted "mango-otter-7" when reciting injected brain facts; both
  facts are correctly persisted in `brain.txt` (restart-survival passed).
- **Ollama**: `dex-ctl` single-instance (flock + comm/uid/exe identity,
  TERM→KILL, orphan reaping). Live cycle: start ~6s, warm 8s, stop,
  zero leftover processes. Log clean: no panic/fatal/OOM.
- **Phone tools**: battery, clipboard read, notification, vibrate,
  toast, telephony-info, contacts, SMS-inbox all live-verified.
  Mic recording works (RECORD_AUDIO now granted — 2s clip written).
  `termux-speech-to-text` runs without error; returned empty transcript
  — needs one human-voice test to fully confirm recognition.
- **`local_intent` audit entries** at 23:36 UTC trace to a test session
  of `tune/agent-v1.19-fast2-intents.py`/`-p2p2.py` (deterministic recall
  candidate) — NOT deployed. Deployed `agent.py` has no local_intent.
- **Home preview** `preview/litt-home.mjs` on `feat/litt-home-preview`
  (tip `b420169d`): 40-col PTY render clean; Home→litt-menu→`0`→Home
  return captured with re-render evidence.

## Known gaps / flagged items

1. Installed `litt-local` is stale — filters `@litlabs/litt-cli`
   (renamed `@litlabs1/litt-cli`); repo copy is correct. Optional sync.
2. rish needs `chmod 400 ~/bin/rish_shizuku.dex` run on the Termux
   side (proot chmod does not stick) + Shizuku running.
3. CALL_PHONE grant state unverified (untestable without a real call).
4. `tune/agent-v1.19-fast2-p1p2.py` (deterministic recall + intents)
   is staged, tested, undeployed — separate approval.

## The single remaining approval

Confirm Fast2 stays the daily default (it is live and verified;
`restore.sh` reverts in seconds). Optionally approve installing
`scripts/termux/bin/litt-menu` → `~/bin/litt-menu`.
