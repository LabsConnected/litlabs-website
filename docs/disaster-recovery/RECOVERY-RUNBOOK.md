# LiTT Disaster Recovery — Recovery Runbook

Last verified end-to-end: **2026-10-31** (all restore tests passed; see
`RESTORE-TEST-RESULTS.md`). Final-hardening pass same date: external
heartbeat channel, encrypted credential kit, Windows ACL hardening added.

## 1. Architecture

Three independent layers; each layer is sufficient alone for full recovery.

```
phone (Termux)
  L1  ~/litt-backups/system/{increments,git-snapshots,daily,verify}
        local snapshots, SHA-256 manifest per snapshot
  L2  PC over Tailscale SSH (litbi@100.107.123.73:2222, key ~/.ssh/litt_pc)
        C:\Users\litbi\litt-phone-backups\daily\<id>
        per-file SHA-256 verified after transfer (certutil)
  L3  Backblaze B2  (S3 endpoint s3.us-east-005.backblazeb2.com)
        bucket litt-disaster-recovery, prefix phone-backups/
        rclone crypt remote "littcrypt" — contents AND filenames
        encrypted on-device before upload; verified by byte-for-byte
        download compare after upload
```

Drivers (Termux side, `~/bin/`):
- `litt-backup` — backup engine (tiers, layers, verify, restore, health)
- `litt-backup-sched` — scheduler daemon (tick every 60 s)
- `~/litt-backup/config.env` — authoritative configuration
- `~/litt-backup/state/` — markers, queue, health.json, logs, alerts

PC side (`C:\Users\litbi\`):
- `bin\rclone.exe` + `.config\rclone\rclone.conf` — independent cloud access
- `litt-supervisor\supervisor.ps1` + Task Scheduler `LiTT-BackupSupervisor`
  (logon + every 30 min, non-overlapping, catch-up on missed runs)
- `litt-phone-backups\cloud.pass` — escrowed crypt password
- `litt-phone-backups\dr-config-snapshot-20261031.tar.gz` + `ROLLBACK.md`

## 2. Backup locations

| Layer | Location | Retention (live config) |
|---|---|---|
| Local daily | `~/litt-backups/system/daily/<yyyymmdd>/` | KEEP_DAILY=7 (activates only after a PASS verify) |
| Local git-snap | `…/git-snapshots/<ts>/` | KEEP_SNAP=4 |
| Local increments | `…/increments/<ts>/` | KEEP_INCR=48 |
| PC daily | `C:\Users\litbi\litt-phone-backups\daily\<id>\` | PC_KEEP_DAILY=14 |
| Cloud | `b2dr:litt-disaster-recovery/phone-backups/<id>/` | manual policy — see RETENTION-DRY-RUN.md |

A daily snapshot contains: `bundles/` (all-refs, stashes, unpushed git
bundles), `worktrees/` (per-worktree tar of dirty+whitelisted files incl.
.env*), `configs/` (litt/devin/gh/ssh/ollama modelfiles), `stash-list.txt`,
`worktree-list.txt`, `all-refs.txt`, `MANIFEST.md`, `CHECKSUMS.sha256`.

## 3. Encryption design

- Transport: SSH (PC layer) and TLS (B2).
- At rest in cloud: rclone `crypt`, `filename_encryption=standard`,
  `directory_name_encryption=true`. Everything under `phone-backups/` is
  ciphertext; plaintext names exist nowhere on B2.
- Crypt password: 64-hex-char random, `~/litt-backup/cloud.pass` (0600),
  generated once by `cloud-init`, **never uploaded**, escrowed to
  `C:\Users\litbi\litt-phone-backups\cloud.pass`.
- B2 application key: scoped to bucket `litt-disaster-recovery` AND prefix
  `phone-backups/` — it cannot read, list, modify, or delete anything else
  in the bucket. Stored in `~/litt-backup/b2.env` and the `b2dr` rclone
  remote on both devices.
- `b2dr` remote has `no_check_bucket=true` (scoped keys cannot
  CreateBucket — required or uploads fail with "not entitled").

## 4. Scheduler configuration

`litt-backup-sched supervise` — tick every 60 s, one tier per wake:

| Tier | Interval | Marker |
|---|---|---|
| incremental | 29 min (1740 s) | `state/last_incremental` |
| gitsnap | 6 h | `state/last_gitsnap` |
| daily | 04:17, max 1/22 h | `state/last_daily` |
| verify | Sun 05:42, weekly | `state/last_verify` |

Every `run` ends with `flush_queue` (PC then cloud, bounded retries with
exponential backoff: base 300 s ×2, cap 7200 s, dead-letter after 8) and
`prune` (only after a PASS verify; never deletes a snapshot still queued).

Reliability features: pidfile + cmdline identity check, stale-lock cleanup,
flock'd ticks, crash backoff (60 s×2^n <=3600 s), 1 MiB log rotation, stable
cwd. Restart paths: Termux:Boot hook `~/.termux/boot/99-litt-backup` (also
acquires `termux-wake-lock`), `.bashrc` auto-revive, termux-services unit
`etc/sv/litt-backup` (dormant unless runsvdir runs).

Manual step Android cannot be forced to do: Settings > Apps > Termux >
Battery > Unrestricted (and vendor autostart/background-permission toggles).
A partial wakelock is held by the boot hook; OEM killers can still win.

**Honest limitation: Android can kill Termux at any time.** Doze, battery
optimization, and OEM task killers can stop the scheduler between restarts.
Catch-up covers missed intervals on restart, but gaps are possible. The PC
supervisor independently flags stale backups (>24 h WARNING, >48 h
CRITICAL) so silent gaps surface. Do not treat this as a guaranteed
continuous service.

## 5. Required recovery tools

- rclone ≥1.60 (phone: `$PREFIX/bin/rclone`; PC: `C:\Users\litbi\bin\rclone.exe`)
- OpenSSH client, git, tar, python3, sha256sum / certutil
- Recovery materials (any TWO of):
  a. `~/litt-backup/b2.env` + `~/litt-backup/cloud.pass`
  b. `~/.config/rclone/rclone.conf` (contains both, obscured)
  c. PC copies: `C:\Users\litbi\.config\rclone\rclone.conf`,
     `C:\Users\litbi\litt-phone-backups\cloud.pass`
  d. `dr-config-snapshot-20261031.tar.gz` (preserved bundle, phone + PC)

## 6. Credential recovery process (no secret values in docs)

1. B2 application key: `~/litt-backup/b2.env` (B2_KEY_ID / B2_KEY) or the
   `b2dr` section of any rclone.conf copy.
2. Crypt password: `~/litt-backup/cloud.pass` or PC
   `litt-phone-backups\cloud.pass` or the `littcrypt` `password=` entry
   (obscured — used directly by rclone.conf; to rebuild from the plaintext
   pass, run `rclone obscure <pass>`).
3. PC SSH key: `~/.ssh/litt_pc` (also inside `configs/config.tar.gz`).

## 7. Phone recovery instructions (Scenario A path — phone dead)

On the PC only:

```powershell
cd C:\Users\litbi
C:\Users\litbi\bin\rclone.exe --config C:\Users\litbi\.config\rclone\rclone.conf `
  copy littcrypt:/<snapshot-id> C:\Users\litbi\litt-dr\restore-<id> --transfers 4
cd litt-dr\restore-<id>
# verify every file:
foreach ($l in Get-Content CHECKSUMS.sha256) {
  $s,$f = $l -split '  ',2
  $h = (certutil -hashfile $f SHA256 | Select-Object -Index 1) -replace ' ',''
  if ($h -ne $s) { Write-Host "MISMATCH $f" }
}
git clone bundles\all-refs.bundle litt-canonical-restored
```

Proven 2026-10-31: full snapshot 20261031 restored on PC, 18/18 SHA-256 OK.

## 8. PC recovery instructions (Scenario B path — PC dead / clean env)

On any machine with rclone:

```bash
# build config from the two material files
set -a; . b2.env; set +a                 # B2_KEY_ID / B2_KEY
cat > rclone.conf <<EOF
[b2dr]
type = s3
provider = Other
endpoint = s3.us-east-005.backblazeb2.com
acl = private
no_check_bucket = true
access_key_id = $B2_KEY_ID
secret_access_key = $B2_KEY
[littcrypt]
type = crypt
remote = b2dr:litt-disaster-recovery/phone-backups
filename_encryption = standard
directory_name_encryption = true
password = $(rclone obscure "$(cat cloud.pass)")
EOF
chmod 600 rclone.conf
rclone --config rclone.conf copy littcrypt:/<id> ./restore-<id>
(cd restore-<id> && sha256sum -c CHECKSUMS.sha256)
```

Proven 2026-10-31 in a clean proot environment: decrypt + hash OK.

## 9. Integrity verification

- Per snapshot: `sha256sum -c CHECKSUMS.sha256` inside the snapshot dir.
- Bundle: `git bundle verify bundles/all-refs.bundle`.
- Cloud: `rclone check --download <src> littcrypt:/<id>` (crypt remotes
  carry no native checksums — full content compare; this is what
  `push_cloud` runs before marking success).
- One-shot: `litt-backup verify` re-validates bundle+clone+checksums+tars.
- PC layer: per-file certutil SHA-256 comparison in `push_pc`.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| `cloud AUTH failure` / `not entitled` | B2 key revoked/rotated — re-deploy b2.env to rclone.conf; confirm `no_check_bucket=true` |
| `not entitled` on upload | missing `no_check_bucket` — scoped keys cannot CreateBucket |
| `PC unreachable — stays queued` | Tailscale down on either end; `ssh -i ~/.ssh/litt_pc -p 2222 litbi@100.107.123.73` |
| scheduler "not running" | `litt-backup-sched start` (stale pidfile auto-cleans); check sched.log |
| `SKIP: another backup job holds the lock` | a tier is still running — normal |
| `*.json.dead` in state/queue | dead-lettered after 8 attempts — fix root cause, rename back to .json to re-queue |
| `low disk` FAIL | free space < MIN_FREE_GB(3) |
| `verify FAILED` | snapshot corrupt — do NOT rely on it; restore from PC/cloud copy |

## 10b. External monitoring (ntfy)

`NTFY_TOPIC` in `config.env` points at a free ntfy.sh topic (the topic name
IS the channel secret — treat it accordingly; content is minimal status
text only). Phone posts: every successful cloud-sync, every alert, every
health-state transition, and `litt-backup heartbeat` on demand. PC
supervisor posts: per-run liveness ping, non-HEALTHY alerts, recovery.
Dead-man property: if phone backups go stale, the PC-side supervisor posts
CRITICAL at >48 h (verified by simulation). Subscribe the topic in the
ntfy app to receive pushes; silence itself is detectable only by an
external dead-man service (e.g. healthchecks.io) — `litt-backup heartbeat`
can be pointed at any URL for that.

## 11. Rollback procedure

`~/litt-backup/pre-hardening-20261031/ROLLBACK.md` — tarballs of every
pre-change config + script, restore commands, and the Windows task removal
(`schtasks /delete /tn LiTT-BackupSupervisor /f`). Same bundle copied to
`C:\Users\litbi\litt-phone-backups\`.

## 12. Known limitations

- Android background execution is best-effort only (see §4).
- Notifications are LOCAL on each device (termux-notification, Windows
  toast). There is no off-device push channel — a dead phone + dead PC
  produces no alert. Acceptable only because two independent devices watch.
- B2 key administration (key listing/revocation/creation) requires the B2
  web console — the scoped app key cannot self-manage.
- Cloud retention is manual until the approved policy is implemented —
  see RETENTION-DRY-RUN.md.
- The encrypted credential kit (`litt-dr-kit-20261031.tar.gz.enc`,
  AES-256/PBKDF2) exists on phone, PC, and inside the B2 bucket; its
  passphrase is intentionally stored nowhere on-device.
