# LiTT Backup Retention — DRY RUN ONLY

Date: 2026-10-31. **Nothing was deleted, pruned, or lifecycle-changed.**
This report is a proposal; pruning requires explicit approval.

## 1. Inventory

### Phone — `~/litt-backups/system` (252 MiB total)

| Tier | Snapshots | Sizes | Oldest | Newest |
|---|---|---|---|---|
| daily | 1 | 245 MiB | 20261031 | 20261031 |
| git-snapshots | 4 | ~1.3 MiB ea | 20261031-141903 | 20261031-142758 |
| increments | 3 | 16 KiB–1.3 MiB | 20261031-141531 | 20261031-160900 |

### PC — `C:\Users\litbi\litt-phone-backups` (~464 MiB)

`daily\20261031` (verified, 18/18 SHA-256), plus two legacy ad-hoc backup
dirs (`litt-phone-backup-offline-20261025-*`, `litt-phone-backups-20261024-*`)
— pre-existing, out of scope of this policy, preserved.

### Cloud — `b2dr:litt-disaster-recovery/phone-backups/` (244.7 MiB, 20 objects)

| Path | Objects | Size | Class |
|---|---|---|---|
| `20261031/` | 19 | ~245 MiB | daily snapshot — KNOWN-GOOD, verified |
| `dr-test-20261031/` | 1 | 16 KiB | test artifact |
| `dr-interrupt-test/` | 1 | ~57 MiB | test artifact |
| `dr-corrupt-test/` | 1 | 25 B | test artifact (intentionally corrupt) |

`b2_list_file_versions` on the prefix: **20 objects / 20 records / 0
multi-version** — no object has ever been overwritten or deleted.
Bucket `litt-disaster-recovery` (allPrivate): **no lifecycle rules, no
default retention, no file-lock** — every version is kept indefinitely
until explicitly deleted. The application key is prefix-scoped to
`phone-backups/`; objects elsewhere in the bucket (~50, pre-existing)
are invisible and untouchable to these credentials by construction.

## 2. Policy targets vs current state

| Class | Target | Current | Would retain | Deletion candidates |
|---|---|---|---|---|
| Daily | 7 days | 1 (0 days old) | all | none |
| Weekly | 4 weeks | 0 distinct weeks | n/a | none |
| Monthly | 12 months | 0 | n/a | none |
| Manual recovery points | preserve | legacy PC dirs | all | none |
| Current known-good | preserve | 20261031 | yes | none |
| Increments | 48 | 3 | all | none |
| Git-snaps | 4 | 4 | all | none |

**Deletion candidates under policy: NONE.** The system is 1 day old;
nothing has aged out.

## 3. Optional cleanup candidates (NOT covered by policy — requires approval)

| Item | Size | Note |
|---|---|---|
| `littcrypt:/dr-test-20261031/` | 16 KiB | round-trip artifact |
| `littcrypt:/dr-interrupt-test/` | ~57 MiB | resume-test artifact |
| `littcrypt:/dr-corrupt-test/` | 25 B | intentional corruption artifact — keep as detection evidence? |
| PC `litt-dr\scenario-a\` | ~245 MiB | restore-test copy, local PC only |

Left in place per the never-delete rule. Estimated reclaimable: ~302 MiB
cloud + ~245 MiB PC-local, if approved.

## 4. Live retention mechanics (already enforced, safe)

- Local `prune` runs only after a PASS `verify` (guard: `verify_ok=1`);
  never deletes a snapshot that is still queued for off-device push.
- PC prune keeps `PC_KEEP_DAILY=14` dailies; same verify guard.
- Cloud: **no automated deletion exists** in litt-backup — correct.
  Any future cloud retention must operate per-snapshot-id via
  `rclone purge littcrypt:/<id>` only, and only for ids older than the
  daily/weekly/monthly policy windows with a verified successor.

## 4b. Storage growth estimate

- Snapshot size today: ~245 MiB (dominated by `bundles/all-refs.bundle`).
- Policy at steady state: 7 daily + 4 weekly + 12 monthly = up to
  23 retained snapshots => ~5.5 GiB cloud.
- Local worst case: ~1.7 GiB (7 daily + snaps + increments).
- B2 cost at $6/TB-month: ~$0.03/mo beyond the 10 GB free tier —
  effectively $0 for year 1.
- Growth driver is repo history (~15%/yr assumed) => ~6.3 GiB year-1.
  Re-estimate quarterly; storage stays <$0.10/mo for years.
- Recovery kit (`recovery-kit/`): +6 KB, preserved manually (always keep
  the newest kit; older kits preserve older crypt passwords on rotation).

## 5. Recommendations

1. Keep cloud retention manual until ≥3 verified snapshots exist.
2. When implementing cloud retention: require per-snapshot
   `rclone check --download` PASS on the successor before deleting
   anything, and never delete `dr-*` artifacts without explicit list.
3. Re-run this dry-run monthly; the report doubles as the approval record.
