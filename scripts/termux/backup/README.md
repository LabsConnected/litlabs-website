# LiTT Phone Backup System (scripts/termux/backup)

Automatic backup & recovery for the LiTT phone dev environment.

## Install (Termux side)

    cp scripts/termux/backup/litt-backup       ~/bin/litt-backup
    cp scripts/termux/backup/litt-backup-sched ~/bin/litt-backup-sched
    cp scripts/termux/backup/config.env        ~/litt-backup/config.env
    chmod +x ~/bin/litt-backup ~/bin/litt-backup-sched
    litt-backup-sched install        # daemon + auto-revival hooks

## Commands

    litt-backup status               # health overview (last runs, PC/cloud, alerts)
    litt-backup now                  # immediate incremental backup + queue flush
    litt-backup list                 # snapshot inventory
    litt-backup verify [id]          # integrity check + clone test
    litt-backup restore <id> <dest>  # restore snapshot to a SAFE separate dir
    litt-backup run <tier>           # incremental | gitsnap | daily
    litt-backup queue                # pending off-device transfers

## Schedule (litt-backup-sched daemon)

- every 30 min : incremental (changed/untracked files by hash + new commits bundle)
- every 6 h    : git snapshot (unpushed-branch + stash bundles + worktree archives)
- daily 04:17  : full snapshot (all-refs bundle + stashes + worktrees + configs + manifest)
- weekly Sun 05:42 : integrity verify + restore test

Auto-revival: `.bashrc` hook (every Termux shell), `~/.termux/boot/99-litt-backup`
(Termux:Boot app), and `$PREFIX/etc/sv/litt-backup` (termux-services/runsvdir).
A daemon started inside the Devin proot dies with the session
(proot `--kill-on-exit`) — run `litt-backup-sched install` once from a real
Termux shell. Android doze may still pause it unless Termux is exempted from
battery optimization (Settings > Apps > Termux > Battery > Unrestricted).

## Layers

1. Phone: `~/litt-backups/system/` mode 0700; 7 daily retained.
2. PC: `C:\Users\litbi\litt-phone-backups\daily\<id>` over Tailscale SSH;
   per-file SHA-256 verified; queued + retried while unreachable.
3. Cloud: `rclone` remote via `CLOUD_REMOTE` in config.env — pending until a
   private remote is configured; snapshots stay queued.

## Secrets

`.env*` / `*.local` / key files inside worktrees and `~/.ssh/litt_pc` are
captured (disaster recovery needs them) but live only inside 0700-restricted
archives. Never push `~/litt-backups/` to any remote. For encrypted-at-rest
archives, set a GPG recipient and wrap `config_tar` output — not enabled by
default.

## Notes

- Bundles capture COMMITTED history; tarballs capture uncommitted+untracked.
- Model weights (`~/.ollama/models`, node_modules, dist, .next) excluded;
  Modelfiles are re-exported via `ollama show` into each daily snapshot.
- Retention + PC pruning stay disabled until the first `verify` PASS.
