# LiTT Backup Health Report

Generated: 2026-10-31 (UTC-4)

## Phone — `~/litt-backup/state/health.json` (live, rewritten every tick)

```json
{
  "device": "phone",
  "state": "HEALTHY",
  "state_reason": "verified recently",
  "last_attempted_utc": "2026-10-31T19:47:51+00:00",
  "last_verified_utc":   "2026-10-31T19:51:33+00:00",
  "last_cloud_verified_utc": "2026-10-31T19:22:31+00:00",
  "next_scheduled_utc":  "2026-10-31T20:16:51+00:00",
  "pending_queue": 0
}
```

## PC — `C:\Users\litbi\litt-supervisor\supervisor-health.json`

```json
{
  "device": "LITREECEO",
  "state": "HEALTHY",
  "latest_snapshot": "20261031",
  "snapshot_age_hours": 1.4,
  "cloud": "ok",
  "recovery_materials": { "cloud_pass": true, "rclone_conf": true },
  "checked_utc": "2026-10-31T19:56:19+00:00"
}
```

## Health model

| State | Condition |
|---|---|
| HEALTHY | verified backup < 24 h old |
| WARNING | no verified backup in 24–48 h; or degraded sub-check (cloud unreachable / recovery material missing on PC) |
| CRITICAL | no verified backup > 48 h; integrity verification FAILED; dead-lettered queue item |
| UNKNOWN | no marker data — status cannot be determined |

Timestamps are UTC ISO-8601 on both devices — device clock skew does not
affect comparisons (ages computed per-device then recorded in UTC).

## Tracked fields (phone ledger)

`last_attempted`, `last_success`, `last_verified`, `last_pc_verified`,
`last_cloud_verified`, `last_tier`, `snapshot_id`, `cloud_size_bytes`,
`verify_result`, `device`, `last_error`, `pending_queue`,
`next_scheduled_utc`, `state`, `state_reason`, `updated_utc`.

## Notification channels (tested)

| Channel | Type | Test result |
|---|---|---|
| `termux-notification` (phone) | local | DELIVERED (rc=0, 2026-10-31) |
| Windows balloon toast (PC) | local | implemented in supervisor.ps1; fires on non-HEALTHY |
| `state/alerts.log` + `litt-backup alerts` | persistent record | ACTIVE — every alert also persisted |
| ntfy.sh topic `litt-bk-<random>` | external, free | **DELIVERED** — POST->feed verified: heartbeats + CRITICAL + recovery all received |
| Dead-man (silence) detection | external service | partial — PC supervisor escalates stale phone backups >24h/>48h via ntfy; a true silence-detector needs a heartbeat service account (optional user add-on) |

Alert conditions wired: repeated tier failures (6 h dedup), overdue daily
(>30 h), stuck queue (>6 h), never-verified, low storage (<5 G warn / <3 G
hard gate), cloud auth denial, cloud verify failure, dead-letter, and
recovery-after-failure ("tier recovered after N failures" — tested live).
