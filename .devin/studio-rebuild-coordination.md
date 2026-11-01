# Studio Rebuild — Coordination & File Ownership

> **Integration branch:** `rebuild/studio-canonical-20261031` (pushed to origin)
> **Coordinator:** Devin (this session)
> **Worktree:** `C:\LiTT\Worktrees\studio-rebuild`
> **Baseline checkpoint:** `58c8ac31` — consolidated in-flight canonical working-tree state
> **Production:** HOLD. No merging, no deployment.

Coordination happens through this branch — fetch/rebase, do not ask Larry to relay SHAs.

## Composition of the branch

| Layer | Commits |
|---|---|
| Studio mission branch (pre-existing) | `c2ba0e13` + 22 earlier commits |
| PR #763 cyber-tree brand (cherry-picked, Larry's authorship kept) | `9fc18ba8`, `0765acbd`, `7ec00bef`, `46ffe1da` |
| Test alignment to new mark | `dd4fadfa` |
| Baseline snapshot of canonical uncommitted work | `58c8ac31` |

## Lane ownership

| Lane | Owner | Owns |
|---|---|---|
| **Studio shell / layout / brand** | Devin | `src/app/(app)/studio/components/shell/**`, `CommandStudioHeader.tsx`, `StudioPreviewPanel.tsx` (chrome only), `src/components/branding/**`, `design/`, global styles |
| **Chat-route recovery** | Panda (PandaOS) | `src/app/api/studio/conversations/**`, `src/app/api/studio/tasks/**`, `src/app/api/studio/command/**`, `useCanonicalConversation.ts`, `optimistic-conversation.ts`, `useStudioTasks.ts` + tests, message/send/cancel/regenerate behavior |
| **Shared — coordinate before editing** | both | `CommandStudio.tsx` (Devin: layout composition / Panda: data wiring), `CommandComposer.tsx` (Devin: visuals / Panda: submit lifecycle), `StudioPreviewPanel.tsx` internals |

Rules: pull-rebase before pushing; never force-push this branch; smallest-diff
wins on shared files; record every task in `tasks/studio-rebuild-ledger-20261031.md`
as verified / partial / blocked / pending with evidence.

## PandaOS / startup lane status

- **Startup optimization:** `activation and live acceptance pending` — NOT complete.
  At the next authorized restart verify: launch, new-session initialization,
  a real AI response, a file edit, and rollback readiness. Report measured
  in-app timings, not expected timings.
- **Do NOT restart PandaOS while active work is running.**

## Immediate design proposal gate

`design/proposals/studio-shell-proposal-20261031.html` — full-screen proposal
for the Studio shell rebuild. **Implementation waits for Larry's approval.**
