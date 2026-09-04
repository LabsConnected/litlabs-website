# LiTT Studio Owner Acceptance Script — Larry

Run this in an authenticated browser session at https://www.litlabs.net.

**You do not need to share any credentials, cookies, or tokens with anyone.
Just run this flow yourself and report the results.**

Do not start until production is serving the PR #133 merge SHA
(Devin will confirm this before handing you the script).

---

## Pre-flight

1. Open https://www.litlabs.net in your browser
2. Open DevTools → Network tab and Console tab

---

## Step 1 — Sign in

**ACTION:** Sign in with your Clerk account.

**EXPECTED:** You are signed in. No error page.

**IF FAILED:** Screenshot the error page or Clerk error message.

---

## Step 2 — Create a fresh acceptance project

**ACTION:** Create a new project named `owner-acceptance`. Choose Blank.

**EXPECTED:** Project appears in the sidebar. Workspace provisions.

**IF FAILED:** Screenshot the project creation screen + any error.

---

## Step 3 — Open LiTT Studio

**ACTION:** Navigate to https://www.litlabs.net/studio

**EXPECTED:** Studio reaches Ready (no infinite spinner, no blank screen).
If it takes more than 8 seconds you should see a Retry button.

**IF FAILED:** Screenshot whatever screen you see (spinner, blank, error).

---

## Step 4 — Ask LiTT

**ACTION:** In the Studio chat composer, type exactly:

```
Reply exactly OWNER_STUDIO_OK
```

Press Enter.

**EXPECTED:** LiTT responds with `OWNER_STUDIO_OK`.

**IF FAILED:** Screenshot the chat. Copy any error text from the response.
Note the Network tab status code for `/api/studio/conversations/.../messages`.

---

## Step 5 — Read a project file

**ACTION:** In the file explorer, click any file (e.g. `package.json`).

**EXPECTED:** File contents render in the editor panel.

**IF FAILED:** Screenshot the file explorer + editor area.

---

## Step 6 — Write a harmless acceptance file

**ACTION:** In the chat, type:

```
Create a file called owner-acceptance.txt with the content: OWNER_ACCEPTANCE_OK
```

**EXPECTED:** An approval card appears asking you to approve the file write.

**IF FAILED:** Screenshot the chat. Note whether an approval card appeared at all.

---

## Step 7 — Approve the file write

**ACTION:** Click Approve on the approval card.

**EXPECTED:** The file `owner-acceptance.txt` appears in the file tree.
Open it and confirm the content is `OWNER_ACCEPTANCE_OK`.

**IF FAILED:** Screenshot the approval card + file tree after approval.

---

## Step 8 — Trigger another safe approval and DENY

**ACTION:** In the chat, type:

```
Create a file called deny-test.txt with the content: SHOULD_NOT_EXIST
```

When the approval card appears, click Deny.

**EXPECTED:** `deny-test.txt` does NOT appear in the file tree.
LiTT acknowledges the denial.

**IF FAILED:** Screenshot the file tree showing whether deny-test.txt exists.

---

## Step 9 — Open Terminal

**ACTION:** Open the terminal panel in Studio.

**EXPECTED:** Terminal connects. You see a shell prompt.

**IF FAILED:** Screenshot the terminal panel. Note any error message.

---

## Step 10 — Run a harmless command

**ACTION:** In the terminal, type `pwd` and press Enter. Then type `node -v`.

**EXPECTED:** `pwd` shows the project workspace path. `node -v` shows a version.

**IF FAILED:** Screenshot the terminal output (or lack of output).

---

## Step 11 — Start Preview

**ACTION:** Click the Start Preview button.

**EXPECTED:** Preview status changes to starting, then ready.
A preview URL appears.

**IF FAILED:** Screenshot the preview panel. Note the status and any error.
Check Network tab for `/api/studio-projects/.../preview` status code.

---

## Step 12 — Confirm actual rendered content

**ACTION:** Click the preview URL to open it in a new tab.

**EXPECTED:** The dev server renders actual content (not an error page).

**IF FAILED:** Screenshot the preview tab. Copy the URL. Note any error page.

---

## Step 13 — Stop Preview

**ACTION:** Click the Stop button.

**EXPECTED:** Preview status changes to stopped or offline.

**IF FAILED:** Screenshot the preview panel after clicking Stop.

---

## Step 14 — Restart Preview

**ACTION:** Click Start Preview again.

**EXPECTED:** Preview restarts and becomes ready again.

**IF FAILED:** Screenshot the preview panel.

---

## Step 15 — Refresh browser

**ACTION:** Press F5 (or Ctrl+R) to refresh the page.

**EXPECTED:** Same project is selected. Same conversation is visible with
all messages. `owner-acceptance.txt` is still in the file tree.
Preview shows the correct state.

**IF FAILED:** Screenshot what you see after refresh. Note what is missing.

---

## Step 16 — Sign out

**ACTION:** Sign out via the Clerk user menu.

**EXPECTED:** You are redirected to the sign-in page.

**IF FAILED:** Screenshot whatever screen you see.

---

## Step 17 — Sign back in

**ACTION:** Sign in again with the same account.

**EXPECTED:** You are signed in.

**IF FAILED:** Screenshot the error.

---

## Step 18 — Confirm project still exists

**ACTION:** Navigate to https://www.litlabs.net/studio

**EXPECTED:** The same `owner-acceptance` project is visible.
The same conversation is visible with all messages.
`owner-acceptance.txt` is still in the file tree.

**IF FAILED:** Screenshot the Studio. Note what is missing.

---

## Results to report

For each step, report one of:
- **PASS** — worked as expected
- **FAIL** — include the screenshot and error text
- **BLOCKED** — include what blocked you

| Step | Status | Notes |
|------|--------|-------|
| 1. Sign in | | |
| 2. Create project | | |
| 3. Open Studio | | |
| 4. Ask LiTT | | |
| 5. Read file | | |
| 6. Write file (approval) | | |
| 7. Approve | | |
| 8. Deny | | |
| 9. Open Terminal | | |
| 10. Run command | | |
| 11. Start Preview | | |
| 12. Confirm content | | |
| 13. Stop Preview | | |
| 14. Restart Preview | | |
| 15. Refresh | | |
| 16. Sign out | | |
| 17. Sign back in | | |
| 18. Confirm persistence | | |

**Overall verdict:** LiTT Studio is ready for real customers only if ALL steps PASS.

---

## What PR #133 already fixed (code-level)

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

## What only Larry can verify

The code-level work above proves the logic is correct, but only an authenticated
browser session can confirm the full customer journey works end-to-end in
production with real Clerk, real Supabase, real terminal-server, and real LLM
providers. That's what this script is for.
