---
description: "Git workflow and canonical-repository rules for all work in this repo"
trigger: always_on
---

# Git Workflow & Canonical Repository

## Git workflow

- Never perform risky integration work directly on canonical `main`.
- Keep canonical `main` clean.
- Keep canonical `main` synchronized with the authoritative remote.
- Use a dedicated branch/worktree for every feature, fix, experiment, or integration task.
- Before modifying code, confirm the current branch and working-tree state.
- Never overwrite unrelated user changes.
- Never discard uncommitted work unless explicitly instructed.
- Never use destructive Git commands casually.
- Do not force-push `main`.
- Do not reset canonical `main` to a feature branch.
- Do not merge partially validated work into `main`.
- Fetch the remote before final integration.
- Check branch divergence before merging.
- Prefer PR-based integration.
- Delete temporary worktrees/branches only after the work is safely merged or intentionally abandoned.

## Canonical repository

- Treat `~/litt-canonical` as the canonical repository.
- Canonical should normally remain on `main`.
- Feature work belongs in `~/litt-worktrees/...` or another dedicated worktree.
- Never leave canonical `main` in the middle of a merge, rebase, or cherry-pick.
- If canonical is dirty or mid-operation, diagnose it before starting new work.
- Do not copy files manually between worktrees when Git can perform the operation safely.
