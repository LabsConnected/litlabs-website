# LiTT DR — Backup Coverage Audit

Date: 2026-10-31. Scope: what each backup layer protects, what is excluded
and why, and what remains uncovered.

## PROTECTED — captured every daily snapshot

| Data | Mechanism | Verified |
|---|---|---|
| Canonical repo — all refs (branches/tags/remotes/backup-stash refs) | `bundles/all-refs.bundle` (`git bundle --all`); 820 heads; **0/782 manifest refs missing** | fsck PASS |
| Stashes (12) | `bundles/stashes.bundle` (pinned to refs/heads/backup/stash-NN) | bundle verify OK |
| Unpushed commits | `bundles/unpushed.bundle` | included |
| Dirty + uncommitted + untracked files per worktree | `worktrees/<name>.tar.gz` via `git status --porcelain -z --ignored=matching` | restored file hash == live (cbe68183…) |
| Whitelisted secret-ish files in worktrees (.env*, *.local, secrets.*, *.key, *.pem) | same tar (intentional whitelist) | covered |
| Worktree metadata | `worktree-list.txt`, `all-refs.txt`, `stash-list.txt` | present |
| Agent config | `.litt/`, `.config/litt/`, `.config/devin/`, `.config/gh/` | config.tar.gz |
| LiTT CLI config | `.litt-env.sh`, `.litt-functions`, `.litt-install-path.sh`, `.litt-startup.sh` | config.tar.gz |
| Studio/dev config | worktree `.env*` files (inside worktree tars) | covered |
| Dev scripts | `~/bin/` (incl. litt-backup, litt-backup-sched, litt-studio, pc) | config.tar.gz |
| Termux env | `.termux/termux.properties`, `.termux/boot/`, `.bashrc`, `.profile` | config.tar.gz (added this pass) |
| Agent skills | `.agents/` (670K) | config.tar.gz (added this pass) |
| Ollama agents + tunes | `private-agent/tune/`, `private-agent/*.{env,py,md}` | config.tar.gz |
| Ollama model definitions | exported per-model `.modelfile` → `configs/modelfiles.tar.gz` | config_tar (regenerable weights excluded) |
| Recovery docs | `litt-backup/docs/` | config.tar.gz (added this pass) |
| PC ssh key | `.ssh/litt_pc[.pub]`, `.ssh/config`, `known_hosts` | config.tar.gz |

## PROTECTED VIA SEPARATE ESCROW — intentionally NOT in routine snapshots

| Data | Mechanism |
|---|---|
| B2 app key (`b2.env`) | encrypted kit (3 locations) + rclone.conf copies |
| rclone crypt password (`cloud.pass`) | PC escrow + kit + inside rclone.conf |
| rclone.conf | kit + PC copy |
| GitHub ssh key (`id_ed25519_litt_phone`) | kit only (rebuildable by re-issue) |
| `KEEP-THIS-KEY.txt` revocation reference | snapshots + kit |

Rationale: live credentials are never placed in unencrypted snapshot dirs;
the kit (AES-256) is the credentialed artifact. Note the existing design
already includes `.env*` worktree files inside snapshot tars — protected
by directory 0700 on phone and litbi-only ACL on PC; cloud copies are
ciphertext.

## EXCLUDED — reproducible / heavyweight (deliberate)

| Data | Why excluded | Rebuild |
|---|---|---|
| `node_modules/`, `.next/`, `dist/`, `build/`, `coverage/`, `.turbo/`, `__pycache__/`, `*.tsbuildinfo` | derived artifacts | pnpm install/build |
| `.ollama/models` (multi-GB weights), `.ollama/history`, `cache` | reproducible model weights | modelfiles captured; re-pull |
| `private-agent/audit.log`, `__pycache__` | logs/derived | n/a |
| `litt-backup/state/` (markers, queue, logs) | operational state, self-regenerating | n/a |
| `.config/{pnpm,htop,configstore,nextjs-nodejs,terminuz}` | tool caches/prefs | reinstall |
| PC `E:\LiTT\Worktrees` (~120 dirs) | PC-side mirrors of phone-canonical git data | bundles restore them |
| proot `/root/litt-canonical` | secondary clone, all branches pushed | GitHub |

## MISSING / LIMITS — honest list

1. **Nothing outside `~/` on the phone** — Termux `$PREFIX` packages are
   not snapshotted (rebuild via `pkg install`).
2. **PC-side-only data** outside `litt-phone-backups` is out of scope of
   the phone backup system (the PC's own dev worktrees are covered
   indirectly through git refs).
3. **Uncommitted work inside `.git`-less directories** (non-repo scratch
   dirs under ~/) is not captured — only git worktrees are scanned.
4. Snapshot payload contains worktree `.env` secrets by design — protect
   snapshot dirs (0700 / user ACL) accordingly; cloud is always ciphertext.
