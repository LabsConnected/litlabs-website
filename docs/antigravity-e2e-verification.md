# Antigravity — E2E Verification Run

> **Do not modify code yet. This is a verification run only.**
>
> Use branch `feat/litt-live-activity-panel` at commit `98b8cc11`.
>
> Create/use a **preview deployment**, not production. Authenticate the browser using the dedicated Clerk test-agent account. Do not weaken Clerk middleware, expose credentials, or use my owner account.
>
> Then perform a full authenticated E2E audit:
>
> 1. Verify `/dashboard`, `/studio`, `/games`, `/showcase`, `/marketplace`, `/discover`, `/wallet`, and `/profile` use the intended canonical AppShell/sidebar.
> 2. Verify sidebar navigation: **Dashboard, Studio, Create, Music, Showcase, Games, Discover, Marketplace, Hire LiTTree**, plus Wallet/Settings/Profile. Flag Gallery or duplicate Showcase/Gallery concepts.
> 3. Audit Studio visually at laptop, 1440px, and 1920px widths. Check for clipping, horizontal overflow, duplicate panels, bad z-index, wasted space, and broken collapse states.
> 4. Studio main navigation should be **Canvas | Code | Preview**. Flag Chat or Files if they still exist as competing top-level workspace tabs.
> 5. Verify the contextual left Files/Components drawer works and doesn't duplicate another permanent file tree.
> 6. Verify the right LiTT panel has **Chat | Live** behavior. Chat must contain the actual transcript/composer. Live must show real execution telemetry.
> 7. Run a **real safe LiTT task** against a non-production test branch. Have LiTT inspect files, read a file, make one harmless test edit, run checks, and report completion.
> 8. While it runs, verify Live receives **real SSE events**, including planning/reasoning summaries, model routing, file reads, tool starts/results, edits, checks, errors, checkpoints, and final status. Do not expose raw private chain-of-thought.
> 9. Verify the main Code/Canvas workspace visibly reflects LiTT's work while Live updates.
> 10. Test **Stop** during an active operation and confirm execution actually stops—not merely the UI.
> 11. Trigger an operation requiring approval. Confirm execution pauses, Approve resumes it, and Reject prevents it.
> 12. Create a checkpoint, make a harmless modification, invoke **Rollback**, and verify the actual workspace/Git state returns to the checkpoint SHA.
> 13. Test model fallback by forcing or safely simulating primary-model failure and verify the backup model continues the task.
> 14. Check browser console, network requests, SSE connection, React errors, Clerk/auth errors, failed API calls, and hydration warnings throughout.
> 15. Refresh Studio during/after testing and verify project, branch, conversation, and relevant UI state remain consistent.
>
> **Do not merge, push to main, or deploy production. Do not fix failures during this run.**
>
> Capture screenshots and exact errors for every failure. At the end give me a matrix with:
> **Test | Expected | Actual | PASS/FAIL | Evidence | Root cause/file if identifiable.**
>
> Finish with one verdict only: **READY FOR MAIN** or **NOT READY FOR MAIN**, with blockers listed.
