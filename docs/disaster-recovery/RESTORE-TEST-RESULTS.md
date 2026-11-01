# LiTT DR — Restore Test Results

Date: 2026-10-31. All destinations were isolated temp dirs; no live source
data was touched. Prior baseline (same day): 10/10 initial checks PASS.

## Scenario results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| A | Phone unavailable — PC-only restore | **PASS** | PC downloaded `littcrypt:/20261031` (245 MiB) via its own rclone+conf, decrypted all files, certutil SHA-256: **18/18 OK, 0 BAD** into `C:\Users\litbi\litt-dr\scenario-a\` |
| B | PC unavailable — independent environment | **PASS** | Clean proot env: rebuilt rclone.conf from `b2.env` + `cloud.pass` + documented params only; listed + decrypted snapshot; MANIFEST.md SHA-256 identical to phone original (`8d107b24…08c8e`) |
| C | Interrupted upload | **PASS** | 60 MiB upload SIGKILL'd mid-transfer → raw B2 listing showed no partial object (atomic PUT); re-upload + download → SHA-256 `abc64d9e…1cc9` identical |
| D | Corrupted backup | **PASS** | Tampered object over same path → pipeline's own `rclone check --download` reported "1 differences found"; downloaded hash mismatched as expected; original good version preserved by B2 versioning |
| E | Scheduler termination | **PASS** | SIGKILL pid 32265 → `status` reported stale pidfile → `start` cleaned it (`16:05:02 stale pidfile (pid 32265) — cleaned`) → new scheduler pid 4444 ticking |

## Hardening tests

| Test | Result | Evidence |
|---|---|---|
| Missed-schedule catch-up | **PASS** | marker rewound 2 h → next tick logged `catch-up: incremental 5529s overdue` and ran the tier |
| Queue retry + exp. backoff | **PASS** | unreachable-PC conf → `attempts:1, next:+300s`; immediate second sync skipped within backoff window |
| Dead-letter bound | code-verified | `MAX_QUEUE_ATTEMPTS=8` → `.json.dead` + alert (not triggered in test — bound is 8 attempts) |
| Overlap protection | **PASS** | manual `run incremental` during scheduled run → `SKIP: another backup job holds the lock` |
| Recovery notification | **PASS** | `fail_incremental=2` → successful run → alert `incremental tier recovered after 2 consecutive failure(s)` via termux-notification |
| Stale-pid cleanup | **PASS** | see Scenario E |
| Windows supervisor | **PASS** | Task `LiTT-BackupSupervisor` (logon + 30 min, IgnoreNew, StartWhenAvailable): LastTaskResult=0, `state=HEALTHY snapshot=20261031 cloud=ok` |

## Round-trip checksums (this session)

| Transfer | Files | Result |
|---|---|---|
| phone → cloud → phone (`/tmp/litt-restore-cloud`) | 18 + manifest | 18/18 SHA-256 OK |
| cloud → PC (`scenario-a`) | 18 + manifest | 18/18 SHA-256 OK |
| phone → cloud → PC decrypt (`test-backup.bin`) | 1 | SHA-256 `87847e57…fcd9` identical |
| interrupted upload → re-download | 1 | SHA-256 identical |

## Test artifacts left intentionally (never auto-deleted)

- `littcrypt:/dr-test-20261031/test-backup.bin` — first round-trip artifact
- `littcrypt:/dr-interrupt-test/interrupt-test.bin` — 60 MiB resume artifact
- `littcrypt:/dr-corrupt-test/good.bin` — deliberately corrupted object
  (detection evidence; original good version retained by B2 versioning)
- `C:\Users\litbi\litt-dr\` — PC-side restore evidence + `scenario-a\`
- `/root/litt-dr/` (proot) — independent-env recovery materials copy

## Finalization-pass tests (2026-10-31)

| Test | Result | Evidence |
|---|---|---|
| Both-devices-lost kit recovery | **PASS** | downloaded `littcrypt:/recovery-kit/litt-dr-kit-20261031.tar.gz.enc` in clean env, AES-256-decrypted, kit's own rclone.conf listed+decrypted snapshot; cloud.pass hash-identical |
| Missed-backup -> external alert | **PASS** | simulated 50h-stale snapshot -> supervisor CRITICAL -> ntfy feed shows `ALERT CRITICAL latest phone snapshot 50h old` + `recovered HEALTHY` |
| External delivery | **PASS** | ntfy POST -> feed read-back verified: `ok heartbeat`, `ok LITREECEO`, alerts |
| Git repo integrity | **PASS** | `git fsck --connectivity-only` clean on all-refs.bundle clone; **0 of 782 manifest refs missing** across bundles (820 heads advertised) |
| Dirty-file recovery | **PASS** | extracted model-switch-fix.tar.gz; cockpit-store.ts sha256 `cbe68183…` == live |
| Windows overlap guard | **PASS** | lockfile held -> supervisor logs `overlap: another supervisor run active -- exiting` |
| PC secret ACLs | **PASS** | cloud.pass / rclone.conf / kit -> `LiTreeCEO\litbi:(F)` only |
| Old-config B2 material scan | **PASS** | only `rclone.conf` + `b2.env` contain B2 keys on phone; no stale copies in backup dirs |
