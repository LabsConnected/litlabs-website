# Studio Owner Acceptance Script — Larry

This is the shortest browser flow to prove the Studio customer journey end-to-end.
Run this in an authenticated browser session at https://www.litlabs.net.

**You do not need to share any credentials, cookies, or tokens with anyone.
Just run this flow yourself and report the results.**

---

## Pre-flight (30 seconds)

1. Open https://www.litlabs.net/studio in your browser
2. Confirm you are signed in (Clerk should show your account)
3. Open browser DevTools → Network tab (to observe API calls)
4. Open browser DevTools → Console tab (to observe errors)

**Expected:** Studio loads without a blank screen. No infinite spinner.
If you see "Studio couldn't finish connecting" after 8 seconds, that's a P0 fail.

---

## Step 1 — Enter Studio and select/create a project (15 seconds)

1. If you already have a project, skip to step 2
2. If not, click "New Project" → choose "Blank" → name it "acceptance-test"
3. Wait for the workspace to provision (status should show "ready")

**Expected:** Project appears in the sidebar. Workspace status shows ready.
**Evidence to capture:** Screenshot of the project name + workspace status.

---

## Step 2 — Ask Myko (30 seconds)

1. In the Studio chat composer, type exactly:
   ```
   Reply with exactly STUDIO_MYKO_OK
   ```
2. Press Enter (or click Send)
3. Wait for the response

**Expected:** Myko responds with `STUDIO_MYKO_OK` (or close to it).
**Evidence to capture:** Screenshot of the prompt + response.
**If it fails:** Note the error message. Check Network tab for the
`/api/studio/conversations/[id]/messages` call — what status code?
What error in the SSE stream?

---

## Step 3 — Read a file (10 seconds)

1. In the file explorer, click any file (e.g. `package.json` or `README.md`)
2. Confirm the file contents render in the editor panel

**Expected:** File contents appear.
**Evidence to capture:** Screenshot of the file tree + editor.

---

## Step 4 — Write a file with approval (30 seconds)

1. In the chat, type:
   ```
   Create a file called studio-acceptance.txt with the content: LARRY_ACCEPTANCE_OK
   ```
2. Wait for the approval card to appear
3. Click "Approve"
4. Confirm the file appears in the file tree

**Expected:** Approval card appears. After approval, `studio-acceptance.txt`
appears in the file tree with the content `LARRY_ACCEPTANCE_OK`.
**Evidence to capture:** Screenshot of the approval card + screenshot of the
file in the tree.

---

## Step 5 — Run the terminal (20 seconds)

1. Open the terminal panel in Studio
2. Type `pwd` and press Enter
3. Type `node -v` and press Enter

**Expected:** `pwd` shows the project workspace path. `node -v` shows a version.
**Evidence to capture:** Screenshot of the terminal with both outputs.

---

## Step 6 — Start preview (30 seconds)

1. Click the "Start Preview" button
2. Wait for the preview to become "ready" (status indicator turns green)
3. Confirm a preview URL appears
4. Click the preview URL to open it in a new tab

**Expected:** Preview starts, becomes ready, URL opens.
**Evidence to capture:** Screenshot of the ready status + preview URL.
**If it fails:** Note the error. Check Network tab for the
`/api/studio-projects/[id]/preview` call.

---

## Step 7 — Stop preview (10 seconds)

1. Click the "Stop" button (added in this PR)
2. Confirm the preview status changes to "stopped" or "offline"

**Expected:** Preview stops. Status shows stopped/offline.
**Evidence to capture:** Screenshot of the stopped status.

---

## Step 8 — Restart preview (15 seconds)

1. Click "Start Preview" again
2. Confirm it becomes ready again

**Expected:** Preview restarts and becomes ready.
**Evidence to capture:** Screenshot of the ready status again.

---

## Step 9 — Persistence after refresh (15 seconds)

1. Refresh the browser page (F5 or Ctrl+R)
2. Confirm the same project is selected
3. Confirm the same conversation is visible with all messages
4. Confirm `studio-acceptance.txt` is still in the file tree
5. Confirm the preview is still running (or shows the correct state)

**Expected:** Everything persists. No blank screen. No lost conversation.
**Evidence to capture:** Screenshot after refresh showing project + chat + files.

---

## Step 10 — Sign out and sign back in (30 seconds)

1. Sign out (Clerk user menu → Sign out)
2. Sign back in
3. Navigate to /studio
4. Confirm the same project, conversation, and files are still there

**Expected:** Everything persists across sign-out/sign-in.
**Evidence to capture:** Screenshot after sign-in showing project + chat + files.

---

## Results to report

For each step, report one of:
- **PASS** — worked as expected
- **FAIL** — include the error message and screenshot
- **BLOCKED** — include what blocked you

| Step | Status | Notes |
|------|--------|-------|
| Pre-flight | | |
| 1. Project | | |
| 2. Myko | | |
| 3. Read file | | |
| 4. Write + approve | | |
| 5. Terminal | | |
| 6. Start preview | | |
| 7. Stop preview | | |
| 8. Restart preview | | |
| 9. Refresh persistence | | |
| 10. Sign-out/in persistence | | |

**Overall verdict:** Studio is ready for real customers only if ALL steps PASS.

---

## What this PR already fixed (code-level)

These root causes were found and fixed through source inspection and automated
tests — no browser session needed:

1. **Preview Stop button** — was missing, now added with DELETE call + tests
2. **BITS starter grant** — was lazy-only (wallet read), now also fires at
   user.created webhook time so new users can use marketplace agents immediately
3. **Floating promises** — `void settleRun`/`persistMemory`/`harvestUserPreferences`
   could leak unhandled rejections; now wrapped in `.catch()`
4. **V2 transport failure** — was silently swallowed; now logged via `studioLog`
5. **wallet-ledger replayed flag** — incorrect for idempotent debit replays; fixed
6. **Cross-user ID leak** — `ensureCanonicalStudioProject` diagnostic query removed
7. **Proxy.ts auth gate** — verified Next.js 16 proxy.ts protects all Studio routes
8. **73 regression tests** covering middleware, BITS, approvals, security, Myko path

## What only Larry can verify

The code-level work above proves the logic is correct, but only an authenticated
browser session can confirm the full customer journey works end-to-end in
production with real Clerk, real Supabase, real terminal-server, and real LLM
providers. That's what this script is for.
