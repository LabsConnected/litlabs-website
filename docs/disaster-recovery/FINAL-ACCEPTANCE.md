# LiTT DR — Final Acceptance Record

Date: 2026-10-31. Combined evidence from the baseline (10/10), hardening
(15 checks), and this finalization pass. Nothing untested is marked PASS.

## Final acceptance table

| Requirement | Result | Evidence |
|---|---|---|
| Replacement B2 key | **PASS** | Authorized OK; scoped bucket+prefix; verified uploads/lists on phone AND PC (this pass) |
| Old exposed key revoked | **BLOCKED — user action** | Old key purged from all configs/scripts/tasks (only 2 files hold B2 material: rclone.conf + b2.env — verified). Revocation needs B2 console — no API path with scoped key. Ref: `~/litt-backup/KEEP-THIS-KEY.txt` (KEEP keyID inside) + sha256[:12] fingerprint 555a0f58185f |
| Encrypted cloud backup | **PASS** | littcrypt upload verified; raw side ciphertext names only |
| Cloud integrity verification | **PASS** | `rclone check --download` after upload; 18/18 sha256 on restore, twice (phone + PC) |
| Independent credential escrow | **PASS (1 user step)** | AES-256 kit in 3 places incl. B2; full both-devices-lost restore proven; **you must store the passphrase offline** — it exists nowhere on-device |
| Recovery without phone | **PASS** | PC decrypted+verified full snapshot, 18/18 certutil |
| Recovery without PC | **PASS** | clean proot env from materials only; kit round-trip proven |
| Recovery of dirty source files | **PASS** | worktree tar extract → hash == live (cbe68183…) |
| Android scheduler recovery | **PASS + documented limitation** | kill→stale-clean→restart verified; wakelock added to boot hook; Android gives no background guarantee — documented, PC watches for staleness |
| Windows backup supervision | **PASS** | task logon+30min, IgnoreNew+lockfile overlap test, StartWhenAvailable, PT10M, litbi-only ACLs |
| External heartbeat monitoring | **PASS** | ntfy channel live: phone heartbeat + PC heartbeat + stale→CRITICAL alert + recovery — all verified in feed |
| Remote notification delivery | **PASS** | POST→feed read-back verified; subscribe `litt-bk-…` topic in ntfy app to receive pushes |
| Backup coverage audit | **PASS** | BACKUP-COVERAGE.md; gaps closed (.agents, .bashrc/.profile, .termux/boot, docs, kit) |
| Retention dry run | **PASS** | RETENTION-DRY-RUN.md; 0 deletion candidates; ~5.5 GiB projected (~$0.03/mo beyond free tier) |
| Production isolation | **PASS** | No prod changes; no port/routing/model changes; Canonical-2026 worktree dirty files untouched, docs left uncommitted |

## Residual user actions

1. **B2 console**: App Keys page — delete every key except the KEEP keyID
   (`~/litt-backup/KEEP-THIS-KEY.txt` or PC copy).
2. **Store the kit passphrase offline** (delivered in mission report).
3. **Subscribe to the ntfy topic** on your phone/devices (topic name in
   mission report — treat as a channel secret).
4. **Android battery**: Settings → Apps → Termux → Battery → Unrestricted
   (manual; cannot be set programmatically without root).
5. **Optional**: free healthchecks.io account if you want true
   silence-detection heartbeats (framework already supports it via
   `NTFY_TOPIC`-style URL hooks — the `heartbeat` command accepts any path).
