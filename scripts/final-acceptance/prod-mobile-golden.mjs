/**
 * LiTT V1 Final Acceptance — Production Mobile Golden Journey
 *
 * Drives a REAL authenticated session on https://www.litlabs.net from a
 * Pixel-7-class mobile context:
 *
 *   sign-in (Clerk sign_in_token magic link)
 *   → Studio → mobile LiTT sheet → real build request
 *   → SSE stream capture (tool_execution, preview, deploy events)
 *   → live preview iframe verification (CSP frame-src / XFO proof)
 *   → keyboard-shrink composer survival
 *   → deploy + production URL verification (when ship routing engages)
 *
 * Auth: Clerk Backend API sign_in_tokens → real browser session.
 * No mocks. No test routes. No bypassed middleware.
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_live_... node scripts/final-acceptance/prod-mobile-golden.mjs
 *   node scripts/final-acceptance/prod-mobile-golden.mjs --env-file /path/.env
 *
 * Optional env:
 *   LITT_PROD_BASE_URL        (default https://www.litlabs.net)
 *   LITT_ACCEPTANCE_USER_ID   (default the known QA user; REQUIRED in CI —
 *                              see below, this script refuses to silently
 *                              fall back when running under GitHub Actions)
 *   LITT_ACCEPTANCE_PROMPT    (default a small static landing page build)
 *   LITT_ACCEPTANCE_DEPLOY    "1" to request deploy in the prompt (default on)
 *   LITT_GOLDEN_PROJECT_ID    the permanent "Golden Acceptance — Ember Roast"
 *                              project. REQUIRED in CI — every run mutates
 *                              this project; local runs without it create the
 *                              project once under the canonical name.
 */

import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { resolveAcceptanceUserId } from "./acceptance-user.mjs";
import { exitCodeForVerdict } from "./verdict-exit.mjs";

// ─── Config ────────────────────────────────────────────────────
const BASE = (process.env.LITT_PROD_BASE_URL || "https://www.litlabs.net").replace(/\/$/, "");

// GITHUB_ACTIONS is set unconditionally by every Actions runner (unlike CI,
// which is only present if a step opts in), so it's the reliable signal that
// we're in the production CI run rather than a local/manual invocation.
const USER_ID = resolveAcceptanceUserId({
  isCI: process.env.GITHUB_ACTIONS === "true",
  envUserId: process.env.LITT_ACCEPTANCE_USER_ID,
});
const DEPLOY_REQUESTED = (process.env.LITT_ACCEPTANCE_DEPLOY ?? "1") !== "0";

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// The permanent golden project. Every CI run mutates THIS project — no more
// timestamped throwaway copies. Registered as the LITT_GOLDEN_PROJECT_ID
// repository secret; in CI an unset value fails the run clearly (same rule
// as LITT_ACCEPTANCE_USER_ID) rather than silently creating a new project.
// Local/manual runs may omit it — the script then creates the project under
// the canonical name so it can be adopted as the permanent one.
const GOLDEN_PROJECT_ID = process.env.LITT_GOLDEN_PROJECT_ID?.trim() || null;
const IS_CI = process.env.GITHUB_ACTIONS === "true";
const GOLDEN_PROJECT_NAME = "Golden Acceptance — Ember Roast";
const FRESH_PROJECT_TEMPLATE = process.env.LITT_ACCEPTANCE_TEMPLATE_ID?.trim() || "empty-static";

// The exact literal the run asks the model to write. The stamp makes every
// run's mutation verifiably fresh on the permanent project — a no-op answer
// ("it's already there") can never produce this text.
const GOLDEN_MARKER = `Golden build ${STAMP}`;
const PROMPT =
  process.env.LITT_ACCEPTANCE_PROMPT ||
  (GOLDEN_PROJECT_ID
    ? DEPLOY_REQUESTED
      ? `In the Ember Roast landing site in index.html, update the footer so it contains exactly this text: ${GOLDEN_MARKER}. Keep everything else unchanged, then publish it live to a public URL.`
      : `In the Ember Roast landing site in index.html, update the footer so it contains exactly this text: ${GOLDEN_MARKER}. Keep everything else unchanged.`
    : DEPLOY_REQUESTED
      ? "Build a simple single-page landing site for a coffee roastery called Ember Roast with a hero, a menu section, and a contact section, then publish it live to a public URL."
      : "Build a simple single-page landing site for a coffee roastery called Ember Roast with a hero, a menu section, and a contact section.");
const ARTIFACT_DIR = path.join("artifacts", "final-acceptance", STAMP);
const SHOT_DIR = path.join(ARTIFACT_DIR, "screenshots");
mkdirSync(SHOT_DIR, { recursive: true });

const KEYBOARD_VIEWPORT = { width: 412, height: 500 };

// ─── Env loading (never printed) ───────────────────────────────
function loadSecret() {
  if (process.env.CLERK_SECRET_KEY) return process.env.CLERK_SECRET_KEY;
  const envFile = process.argv.find((a) => a.startsWith("--env-file="))?.split("=")[1];
  if (envFile && existsSync(envFile)) {
    const content = readFileSync(envFile, "utf-8");
    const m = content.match(/CLERK_SECRET_KEY=(sk_\S+)/);
    if (m) return m[1].trim();
  }
  throw new Error("CLERK_SECRET_KEY not available (env or --env-file)");
}

// ─── Result accumulator ────────────────────────────────────────
const verdict = {
  base: BASE,
  userId: USER_ID,
  goldenProjectId: GOLDEN_PROJECT_ID,
  prompt: PROMPT,
  startedAt: new Date().toISOString(),
  steps: {},
  sseEvents: [],
  consoleErrors: [],
  pageErrors: [],
  filesChangedEvents: [],
  networkSummary: [],
  screenshots: [],
  verdict: "INCOMPLETE",
  notes: [],
  freshAccount: process.env.LITT_ACCEPTANCE_FRESH_ACCOUNT === "1",
};

function step(name, ok, detail) {
  verdict.steps[name] = { ok, detail: detail ?? null, at: new Date().toISOString() };
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, animations: "disabled" }).catch(() => {});
  verdict.screenshots.push(p);
}

// The cookie-consent dialog can re-render after full navigations
// (goto/goBack) and overlays the mobile trigger + composer. Dismiss it
// whenever it appears so assertions hit the real surface underneath.
async function dismissCookieConsent(page) {
  const btn = page
    .getByRole("button", { name: /accept all|essential only/i })
    .first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

// Re-open the LiTT mobile sheet — it is a transient surface that does
// not (and should not) persist across hard refreshes or history nav.
async function openMobileSheet(page) {
  const sheet = page.getByTestId("litt-mobile-sheet");
  if (await sheet.isVisible().catch(() => false)) return;
  // The Developer Tools drawer intentionally owns the mobile surface while
  // open. Close it through the same visible control a user would use before
  // reopening LiTT; do not change product visibility rules for this harness.
  const dockClose = page.getByTestId("dock-close");
  if (await dockClose.isVisible().catch(() => false)) {
    await dockClose.click();
    await page.waitForTimeout(250);
  }
  const trigger = page
    .getByRole("button", { name: "Ask LiTT to build" })
    .first();
  await trigger.click({ timeout: 15_000 });
  await sheet.waitFor({ state: "visible", timeout: 15_000 });
}

// ─── Clerk sign-in token ───────────────────────────────────────
async function createSignInUrl(secretKey) {
  const resp = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID, expires_in_seconds: 900 }),
  });
  if (!resp.ok) throw new Error(`sign_in_tokens failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.url) throw new Error("sign_in_tokens response missing url");
  return data.url;
}

// ─── SSE parser ────────────────────────────────────────────────
function parseSSE(raw) {
  const events = [];
  for (const chunk of raw.split("\n\n")) {
    const line = chunk.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      events.push({ type: "DONE" });
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch {
      events.push({ type: "unparsed", payload: payload.slice(0, 200) });
    }
  }
  return events;
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const secretKey = loadSecret();
  const signInUrl = await createSignInUrl(secretKey);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    recordVideo: { dir: path.join(ARTIFACT_DIR, "video"), size: { width: 412, height: 915 } },
  });

  // Evidence collectors installed before any navigation.
  await context.addInitScript(() => {
    window.__littFilesChanged = [];
    window.addEventListener("studio:files-changed", (e) => {
      window.__littFilesChanged.push({ at: Date.now(), detail: e?.detail ?? null });
    });
    // Run the golden journey in AUTO execution mode — the same mode a user
    // can select in the Studio header. AUTO auto-approves the workspace-safe
    // tool set (files.write, mkdir, rename, patch, commit) so the autonomous
    // build chain streams to completion on a single SSE session. The ACT
    // approval gate and the sensitive-action gate (deploy.execute, push,
    // delete) are intentionally NOT bypassed — they are proven separately.
    try { localStorage.setItem("litt:executionMode", "auto"); } catch {}
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      verdict.consoleErrors.push(msg.text().slice(0, 400));
    }
  });
  page.on("pageerror", (err) => verdict.pageErrors.push(String(err).slice(0, 400)));

  // Capture the canonical chat/build API exchange.
  let messagesApiSeen = null;
  let messagesApiBody = null;
  let messagesApiResponseBody = null;
  page.on("response", (resp) => {
    const url = resp.url();
    if (/\/api\//.test(url)) {
      verdict.networkSummary.push({ status: resp.status(), url: url.replace(BASE, "") });
    }
    if (/\/api\/studio\/conversations\/[^/]+\/messages/.test(url) && resp.request().method() === "POST") {
      messagesApiSeen = { status: resp.status(), url };
      messagesApiBody = resp.request().postData();
      resp.body().then((b) => { messagesApiResponseBody = b.toString("utf8"); }).catch(() => {});
    }
  });

  // Inject a fetch interceptor to capture SSE events in real-time.
  // Playwright's resp.body() waits for the entire stream to close, which
  // may take minutes for long agent loops. This interceptor captures
  // events as they arrive and stores them in window.__littSSEEvents.
  await page.addInitScript(() => {
    window.__littSSEEvents = [];
    window.__littSSEComplete = false;
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const resp = await origFetch.apply(this, args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (/\/api\/studio\/conversations\/[^/]+\/messages/.test(url)) {
        const contentType = resp.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream") && resp.body) {
          // resp.clone() tees the stream — reading the original body here would
          // lock it and the app's own getReader() would throw, breaking the run.
          const reader = resp.clone().body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) { window.__littSSEComplete = true; break; }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                let currentEvent = null;
                for (const line of lines) {
                  if (line.startsWith("data: ")) {
                    try {
                      const evt = JSON.parse(line.slice(6));
                      window.__littSSEEvents.push(evt);
                    } catch {}
                  }
                }
              }
            } catch {
              window.__littSSEComplete = true;
            }
          })();
        }
      }
      return resp;
    };
  });

  try {
    // ── Step 1: sign in via magic link ──
    await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Clerk processes the ticket and redirects through the site.
    await page.waitForURL(/litlabs\.net/, { timeout: 60_000 });
    await page.waitForTimeout(4000);
    const authProbe = await page.request.get(`${BASE}/api/studio-projects`, { timeout: 60_000 });
    step("sign_in", authProbe.status() === 200, `GET /api/studio-projects → ${authProbe.status()}`);
    await shot(page, "01-signed-in");

    // ── Step 1.5: resolve the permanent golden project + provision workspace ──
    // When LITT_GOLDEN_PROJECT_ID is set the run reuses that exact project —
    // persistence across runs is part of what the acceptance proves. Without
    // it (local/manual runs only) the script creates the project once under
    // the canonical name; CI refuses to run without the ID.
    let projectId = null;
    if (GOLDEN_PROJECT_ID) {
      const getResp = await page.request.get(`${BASE}/api/studio-projects/${GOLDEN_PROJECT_ID}`, { timeout: 60_000 });
      const getBody = await getResp.json().catch(() => null);
      const found = getResp.status() === 200 && (getBody?.project?.id ?? getBody?.id) === GOLDEN_PROJECT_ID;
      projectId = found ? GOLDEN_PROJECT_ID : null;
      verdict.projectId = projectId;
      verdict.workspaceId = getBody?.project?.workspaceId ?? getBody?.workspaceId ?? null;
      step("golden_project_resolved", found, `GET /api/studio-projects/${GOLDEN_PROJECT_ID} → ${getResp.status()}`);
    } else if (IS_CI) {
      step("golden_project_resolved", false, "LITT_GOLDEN_PROJECT_ID is not configured — CI runs must target the permanent golden project");
    } else {
      const projResp = await page.request.post(`${BASE}/api/studio-projects`, {
        data: { sourceType: "blank", name: GOLDEN_PROJECT_NAME, templateId: FRESH_PROJECT_TEMPLATE },
        timeout: 60_000,
      });
      const projBody = await projResp.json().catch(() => null);
      projectId = projBody?.project?.id ?? null;
      step("golden_project_resolved", projResp.status() === 201 && !!projectId,
        `created "${GOLDEN_PROJECT_NAME}" HTTP ${projResp.status()} id=${projectId} — set LITT_GOLDEN_PROJECT_ID to reuse it`);
      if (projectId) verdict.notes.push(`adopt as permanent: LITT_GOLDEN_PROJECT_ID=${projectId}`);
    }

    let workspaceReady = false;
    if (projectId) {
      const prepResp = await page.request.post(`${BASE}/api/studio-projects/${projectId}/workspace/prepare`, { timeout: 120_000 });
      const prepBody = await prepResp.json().catch(() => null);
      verdict.notes.push(`workspace/prepare → ${prepResp.status()} ${JSON.stringify(prepBody)?.slice(0, 200)}`);
      workspaceReady = prepResp.status() === 200 && prepBody?.workspaceStatus === "ready";
      // If a 409 "provisioning" race occurred, poll the preview endpoint until ready.
      const prepDeadline = Date.now() + 3 * 60 * 1000;
      while (!workspaceReady && Date.now() < prepDeadline) {
        await page.waitForTimeout(5000);
        const st = await page.request.get(`${BASE}/api/studio-projects/${projectId}/preview`, { timeout: 30_000 }).catch(() => null);
        const proj = await page.request.get(`${BASE}/api/studio-projects/${projectId}`, { timeout: 30_000 }).catch(() => null);
        const pj = proj ? await proj.json().catch(() => null) : null;
        if (pj?.project?.workspaceStatus === "ready" || pj?.workspaceStatus === "ready") workspaceReady = true;
      }
      step("workspace_ready", workspaceReady, `projectId=${projectId}`);

      // The explicit empty-static contract is stronger than merely having a
      // blank-looking preview: before the first request the managed workspace
      // must contain no user application files. Git metadata is not a user
      // project file and is intentionally excluded from this proof.
      const filesResp = await page.request.get(
        `${BASE}/api/studio-projects/${projectId}/files?path=${encodeURIComponent(".")}`,
        { timeout: 60_000 },
      ).catch(() => null);
      const filesBody = filesResp ? await filesResp.json().catch(() => null) : null;
      const entries = Array.isArray(filesBody?.entries) ? filesBody.entries : [];
      const userEntries = entries.filter((entry) => entry?.name !== ".git");
      step("fresh_project_zero_user_files",
        !GOLDEN_PROJECT_ID && FRESH_PROJECT_TEMPLATE === "empty-static" && filesResp?.status() === 200 && userEntries.length === 0,
        `template=${FRESH_PROJECT_TEMPLATE} HTTP ${filesResp?.status() ?? "unreachable"} userFiles=${userEntries.length}`);
    }

    // ── Step 2: Studio loads on mobile with the project selected ──
    const studioResp = await page.goto(`${BASE}/studio?project=${projectId ?? ""}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    step("studio_load", studioResp?.status() === 200, `HTTP ${studioResp?.status()}`);
    await page.waitForTimeout(6000);
    const shellVisible = await page.locator(".studio-shell").isVisible().catch(() => false);
    const triggerVisible = await page.getByTestId("litt-mobile-trigger").isVisible().catch(() => false);
    step("studio_shell", shellVisible && triggerVisible, `shell=${shellVisible} trigger=${triggerVisible}`);
    await shot(page, "02-studio-mobile");

    // ── Step 3: open LiTT mobile sheet, composer usable ──
    await dismissCookieConsent(page);
    await openMobileSheet(page);
    const composer = page.getByTestId("studio-command-input");
    await composer.waitFor({ state: "visible", timeout: 15_000 });
    step("mobile_sheet_open", true);
    await shot(page, "03-sheet-open");

    // ── Step 4: keyboard-open geometry (simulated shrink) ──
    await composer.focus();
    await composer.fill(PROMPT.slice(0, 40));
    await page.setViewportSize(KEYBOARD_VIEWPORT);
    await page.waitForTimeout(800);
    const kb = await page.evaluate(() => {
      const r = (el) => el ? el.getBoundingClientRect() : null;
      const sheet = document.querySelector('[data-testid="litt-mobile-sheet"]');
      const comp = document.querySelector('[data-testid="studio-command-composer"]');
      const input = document.querySelector('[data-testid="studio-command-input"]');
      const send = document.querySelector('[data-testid="studio-send-button"]');
      return { vh: window.innerHeight, vw: window.innerWidth, sheet: r(sheet), composer: r(comp), input: r(input), send: r(send) };
    });
    const inView = (r) => r && r.y < kb.vh && r.y + r.height > 0 && r.x >= 0 && r.x + r.width <= kb.vw + 1;
    const kbOk = inView(kb.sheet) && inView(kb.composer) && inView(kb.input) && inView(kb.send);
    step("keyboard_geometry", kbOk, JSON.stringify({ vh: kb.vh, inputBottom: kb.input ? kb.input.y + kb.input.height : null, sendVisible: !!inView(kb.send) }));
    await shot(page, "04-keyboard-open");
    await page.setViewportSize(devices["Pixel 7"].viewport);
    await composer.fill("");
    await page.waitForTimeout(500);

    // ── Step 5: send the real build request ──
    await composer.fill(PROMPT);
    const sendBtn = page.getByTestId("studio-send-button");
    await sendBtn.waitFor({ state: "visible" });
    await shot(page, "05-prompt-typed");
    await sendBtn.click();
    step("message_sent", true, `prompt="${PROMPT.slice(0, 80)}"`);

    // Wait for the messages POST to appear, then for its stream to finish.
    const deadline = Date.now() + 10 * 60 * 1000; // 10 min budget for build+preview(+deploy)
    while (!messagesApiSeen && Date.now() < deadline) await page.waitForTimeout(500);
    if (!messagesApiSeen) throw new Error("canonical messages API was never called");
    step("canonical_api_called", messagesApiSeen.status === 200, `POST ${messagesApiSeen.url.replace(BASE, "")} → ${messagesApiSeen.status}`);
    verdict.projectId = projectId;
    verdict.conversationId = messagesApiSeen.url.match(/conversations\/([^/]+)/)?.[1] ?? null;

    // Poll until the SSE body is fully captured (response completes)
    // OR until the injected interceptor captures a "done" event.
    while (!messagesApiResponseBody && Date.now() < deadline) {
      await page.waitForTimeout(2000);
      // Check if the injected interceptor has captured a done event
      const sseComplete = await page.evaluate(() => window.__littSSEComplete);
      const sseEvents = await page.evaluate(() => window.__littSSEEvents || []);
      const hasDone = sseEvents.some((e) => e.type === "done" || e.type === "error");
      if (sseComplete || hasDone) {
        // Use the injected events as the response body
        if (!messagesApiResponseBody && sseEvents.length > 0) {
          messagesApiResponseBody = sseEvents.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
        }
      }
      // Surface live progress in the meantime
      const sheetText = await page.getByTestId("litt-mobile-sheet").innerText().catch(() => "");
      if (sheetText) process.stdout.write(".");
    }
    console.log("");
    step("stream_completed", !!messagesApiResponseBody, messagesApiResponseBody ? `${messagesApiResponseBody.length} bytes SSE` : "stream never finished");

    const events = parseSSE(messagesApiResponseBody || "");
    verdict.sseEvents = events.map((e) => ({ ...e, text: e.text ? String(e.text).slice(0, 200) : e.text, summary: e.summary ? String(e.summary).slice(0, 200) : e.summary }));
    writeFileSync(path.join(ARTIFACT_DIR, "sse-events.json"), JSON.stringify(events, null, 2));

    const toolEvents = events.filter((e) => e.type === "tool_execution");
    // Count only successful real file mutations — a read-only tool (files.list,
    // files.read, project.scan) must never satisfy this step.
    const writeEvents = toolEvents.filter((e) =>
      e.success === true &&
      /^(files\.write|files\.mkdir|files\.rename|files\.delete|apply_patch)$/.test(String(e.toolId)));
    step("files_written", writeEvents.length > 0 || (await page.evaluate(() => (window.__littFilesChanged || []).length)) > 0,
      `${writeEvents.length} write-ish tool events, ${await page.evaluate(() => (window.__littFilesChanged || []).length)} files-changed events`);
    verdict.filesChangedEvents = await page.evaluate(() => window.__littFilesChanged || []);

    const previewResult = events.find((e) => e.type === "preview_result");
    const previewStart = events.find((e) => e.type === "preview_start");
    const previewUrl = previewResult?.previewUrl || null;
    step("preview_event", !!(previewStart || previewResult), previewResult ? `success=${previewResult.success}` : "no preview_result event");

    const doneEvt = events.find((e) => e.type === "done");
    const finalText = events.filter((e) => e.type === "text").map((e) => e.text).join("");
    step("assistant_completed", !!doneEvt || finalText.length > 0, finalText.slice(0, 200));

    // Raw model tool-call protocol must never reach the user-visible
    // transcript — a run that "completed" on <tool_call> markup is a
    // false success. Scan every streamed text field, not just the tail.
    const TRANSCRIPT_MARKUP = /<\/?(?:tool_call|dots_function_call|function_call|function_calls)\b|<invoke\b|<arg_(?:key|value)\b|```(?:tool_call|function_call)\b/i;
    const transcriptText = events
      .filter((e) => e.type === "text" || e.type === "done" || e.type === "error")
      .map((e) => String(e.text ?? e.summary ?? ""))
      .join("\n");
    const markupHit = transcriptText.match(TRANSCRIPT_MARKUP)?.[0] ?? null;
    step("no_tool_markup_in_transcript", markupHit === null,
      markupHit ? `leaked protocol token ${JSON.stringify(markupHit)}` : "no raw markup in streamed text");
    await shot(page, "06-after-build");

    // ── Step 6: live preview verification ──
    // The StudioPreviewPanel polls /preview independently; wait for iframe.
    const iframe = page.getByTestId("preview-iframe");
    let iframeSrc = null;
    const iframeDeadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < iframeDeadline) {
      iframeSrc = await iframe.getAttribute("src").catch(() => null);
      if (iframeSrc) break;
      await page.waitForTimeout(3000);
    }
    // The panel stops polling once it lands in "offline" (first status probe
    // raced the build). A real user recovers via the Refresh/Prepare button —
    // exercise that recovery path if the iframe never appeared on its own.
    let manualRecovery = false;
    if (!iframeSrc) {
      const recoverBtn = page.getByTestId("preview-refresh").or(page.getByTestId("preview-prepare"));
      if (await recoverBtn.first().isVisible().catch(() => false)) {
        await recoverBtn.first().click().catch(() => {});
        manualRecovery = true;
        const recDeadline = Date.now() + 2 * 60 * 1000;
        while (Date.now() < recDeadline) {
          iframeSrc = await iframe.getAttribute("src").catch(() => null);
          if (iframeSrc) break;
          await page.waitForTimeout(3000);
        }
      }
    }
    step("preview_iframe_present", !!iframeSrc,
      iframeSrc ? `${iframeSrc.slice(0, 160)}${manualRecovery ? " (after manual refresh)" : ""}` : "no iframe src");

    if (iframeSrc) {
      // Wait for the frame to load
      await page.waitForTimeout(8000);
      const frameUrls = page.frames().map((f) => f.url());
      const childFrame = page.frames().find((f) => f !== page.mainFrame());
      step("preview_frame_loaded", !!childFrame && !!childFrame.url() && childFrame.url() !== "about:blank",
        `frames=${JSON.stringify(frameUrls.map((u) => u.slice(0, 100)))}`);

      // Direct fetch of the preview URL — proves content is actually served
      const direct = await page.request.get(iframeSrc, { timeout: 30_000 }).catch((e) => ({ status: () => -1, headers: async () => ({}), text: async () => String(e) }));
      const status = typeof direct.status === "function" ? direct.status() : -1;
      const body = typeof direct.text === "function" ? await direct.text() : "";
      step("preview_serves_content", status === 200 && body.length > 100, `HTTP ${status}, ${body.length} bytes`);
      writeFileSync(path.join(ARTIFACT_DIR, "preview-body.html"), body.slice(0, 50_000));
      await shot(page, "07-preview-iframe");
    }

    // CSP/XFO violation check — the mobile-Chrome failure mode
    const frameViolations = verdict.consoleErrors.filter((e) =>
      /Refused to (display|frame)|X-Frame-Options|frame-src|framed by/i.test(e),
    );
    step("no_frame_violations", frameViolations.length === 0, frameViolations[0] ?? "clean");

    // ── Step 7: deploy — approval gate, resumed execution, live URL ──
    // project.deploy is a sensitive action: the run MUST pause for explicit
    // approval even in AUTO mode. A deployment that executed without a
    // pending_approval pause would mean the gate was bypassed. The golden
    // then approves through the real server-authoritative endpoint and reads
    // the resumed run's toolCalls for the deployment outcome.
    const approvalEvents = events.filter((e) => e.type === "pending_approval");
    const deployApproval = approvalEvents.find((e) => e.toolId === "project.deploy");
    let deployResult = events.find((e) => e.type === "deploy_result");
    const deployVerify = events.find((e) => e.type === "deploy_verify");
    let productionUrl = deployResult?.productionUrl || deployVerify?.url || null;
    if (DEPLOY_REQUESTED) {
      step("deploy_approval_gate", !!deployApproval, deployApproval
        ? `pausedRunId=${deployApproval.pausedRunId ?? "none"} reason=${String(deployApproval.reason ?? "").slice(0, 120)}`
        : approvalEvents.length > 0
          ? `paused on ${approvalEvents.map((e) => e.toolId).join(",")} — not project.deploy`
          : deployResult ? "deploy executed with NO approval pause — gate bypassed" : "no pending_approval event in stream");

      if (deployApproval?.pausedRunId) {
        const convId = (messagesApiSeen?.url ?? "").match(/conversations\/([^/]+)\/messages/)?.[1];
        // Async approval contract: POST returns 202 immediately, then poll
        // GET for the resumed execution result. This avoids the Cloudflare
        // 524 timeout that occurred when the approval endpoint synchronously
        // awaited the full resumed agent loop (deploy + model continuation).
        const approval = convId
          ? await page.request.post(
              `${BASE}/api/studio/conversations/${convId}/approvals/${deployApproval.pausedRunId}`,
              { data: { decision: "approved" }, timeout: 30_000 },
            ).catch(() => null)
          : null;
        const approvalBody = approval ? await approval.json().catch(() => null) : null;
        writeFileSync(path.join(ARTIFACT_DIR, "deploy-approval-response.json"), JSON.stringify(approvalBody, null, 2));
        step("deploy_approved", (approval?.status() === 202 || approval?.status() === 200) && approvalBody?.resolved === true,
          `HTTP ${approval?.status() ?? "no-request"} resolved=${approvalBody?.resolved} status=${approvalBody?.status ?? "none"}`);

        // Poll GET for the resumed execution result
        let runResult = approvalBody?.runResult ?? null;
        let runError = approvalBody?.runError ?? null;
        const runStatus = approvalBody?.runStatus ?? approvalBody?.status ?? "processing";
        if (!runResult && runStatus === "processing" && convId) {
          const pollDeadline = Date.now() + 15 * 60 * 1000; // 15 min budget (deploy + model continuation can take 10+ min)
          while (Date.now() < pollDeadline) {
            await page.waitForTimeout(3000);
            const statusResp = await page.request.get(
              `${BASE}/api/studio/conversations/${convId}/approvals/${deployApproval.pausedRunId}`,
              { timeout: 15_000 },
            ).catch(() => null);
            if (!statusResp || !statusResp.ok()) continue;
            const statusBody = await statusResp.json().catch(() => null);
            if (!statusBody) continue;
            if (statusBody.runStatus === "completed" && statusBody.runResult) {
              runResult = statusBody.runResult;
              break;
            }
            if (statusBody.runStatus === "failed") {
              runError = statusBody.runError ?? "Execution failed";
              break;
            }
            // Still processing — keep polling
          }
        }

        const resumedCalls = runResult?.toolCalls ?? [];
        const deployCall = resumedCalls.find((c) => c.toolId === "project.deploy");
        if (deployCall) {
          // summarizeToolResult JSON-encodes object results; publicUrl may be
          // truncated at 200 chars, so fall back to constructing the URL from
          // the deploymentId (both fields sit early in the serialized object).
          const summary = String(deployCall.summary ?? "");
          productionUrl = productionUrl
            ?? summary.match(/"publicUrl":"(https?:\/\/[^"]+)"/)?.[1]
            ?? (() => { const id = summary.match(/"deploymentId":"([^"]+)"/)?.[1]; return id ? `${BASE}/sites/${id}` : null; })()
            ?? summary.match(/https?:\/\/[^\s"'\\]+\/sites\/[^\s"'\\]+/)?.[0]
            ?? null;
          deployResult = deployResult ?? {
            success: deployCall.success === true && !!productionUrl && /"status":"ready"/.test(summary),
            productionUrl,
            error: String(summary).slice(0, 200),
          };
        }
        if (runResult?.pendingApproval) {
          verdict.notes.push(`resumed run paused again on ${runResult.pendingApproval.toolId}; a second-stage pause is not resumable via this endpoint`);
        }
        if (runError && !deployResult) {
          deployResult = { success: false, productionUrl: null, error: runError };
        }
      }

      if (deployResult) {
        step("deploy_result", deployResult.success === true,
          deployResult.success ? `url=${productionUrl}` : `error=${deployResult.error ?? "failed"}`);
      } else {
        verdict.notes.push("Deploy requested but produced no deploy_result event and no resumable project.deploy pause.");
        step("deploy_result", false, "no deploy evidence");
      }

      if (productionUrl) {
        const prodResp = await page.request.get(productionUrl, { timeout: 45_000 }).catch(() => null);
        const prodStatus = prodResp?.status() ?? -1;
        const prodBody = prodResp ? await prodResp.text().catch(() => "") : "";
        writeFileSync(path.join(ARTIFACT_DIR, "deployment-body.html"), prodBody.slice(0, 50_000));
        verdict.liveDeploymentUrl = productionUrl;
        step("production_url_verified",
          prodStatus === 200 && prodBody.length > 100 && /ember roast/i.test(prodBody),
          `GET ${productionUrl} → ${prodStatus} (${prodBody.length}b, expectedContent=${/ember roast/i.test(prodBody)})${deployVerify ? `; flow verify=${deployVerify.success}` : ""}`);
      } else {
        step("production_url_verified", false, "no productionUrl in events or resumed run");
      }
    } else {
      verdict.notes.push("Deploy not requested (LITT_ACCEPTANCE_DEPLOY=0).");
    }

    // ── Step 7.5: exact-content + placeholder verification via file read-back ──
    // The golden prompt requests a stamped literal ("Golden build <stamp>");
    // the fresh-create path requests the Ember Roast brand. Either way the
    // file on disk must contain the exact requested text — this is the
    // [PERSON_NAME] regression check (a completion claim with the wrong
    // content is a false success).
    const EXPECTED_LITERAL = GOLDEN_PROJECT_ID ? GOLDEN_MARKER : "Ember Roast";
    const readWorkspaceFile = async (filePath) => {
      if (!projectId) return null;
      const resp = await page.request
        .get(`${BASE}/api/studio-projects/${projectId}/files/raw?path=${encodeURIComponent(filePath)}`, { timeout: 60_000 })
        .catch(() => null);
      if (!resp?.ok()) return null;
      // files/raw streams .html as text/html; other text files come back
      // as { content } JSON.
      const ct = resp.headers()["content-type"] ?? "";
      if (ct.includes("application/json")) {
        const body = await resp.json().catch(() => null);
        return typeof body?.content === "string" ? body.content : null;
      }
      return resp.text().catch(() => null);
    };
    let indexHtml = await readWorkspaceFile("index.html");
    verdict.expectedLiteral = EXPECTED_LITERAL;
    if (indexHtml !== null) {
      writeFileSync(path.join(ARTIFACT_DIR, "index.html"), indexHtml);
    }
    step("file_content_exact",
      indexHtml !== null && indexHtml.includes(EXPECTED_LITERAL),
      indexHtml === null
        ? "files/raw?path=index.html returned no readable content"
        : indexHtml.includes(EXPECTED_LITERAL)
          ? `index.html contains ${JSON.stringify(EXPECTED_LITERAL)}`
          : `index.html (${indexHtml.length}b) missing ${JSON.stringify(EXPECTED_LITERAL)}`);

    // Unresolved redaction/template tokens must never reach disk. Same token
    // families the mutation boundary rejects (patch-validation.ts).
    const PLACEHOLDER = /\{\{\s*[^}{]+\s*\}\}|\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]|\[(?:EMAIL|PHONE|ADDRESS)\]/;
    const placeholderHit = indexHtml?.match(PLACEHOLDER)?.[0] ?? null;
    step("no_unresolved_placeholders", indexHtml !== null && placeholderHit === null,
      indexHtml === null ? "no file content to scan" : placeholderHit ? `found ${JSON.stringify(placeholderHit)}` : "clean");

    // ── Step 7.6: hard refresh preserves project/workspace/conversation/file ──
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => null);
    await page.waitForTimeout(6000);
    const refreshUrl = page.url();
    const projectStillSelected = refreshUrl.includes(`/studio`) && refreshUrl.includes(projectId ?? "\0");
    const shellAfterRefresh = await page.locator(".studio-shell").isVisible().catch(() => false);
    // File read-back after reload — proves the workspace (not just the UI)
    // still holds the mutation.
    const refreshHtml = await readWorkspaceFile("index.html");
    const filePersisted = refreshHtml !== null && refreshHtml.includes(EXPECTED_LITERAL);
    step("hard_refresh_persists",
      projectStillSelected && shellAfterRefresh && filePersisted,
      `url=${refreshUrl.replace(BASE, "")} shell=${shellAfterRefresh} filePersisted=${filePersisted}`);
    await shot(page, "07-after-refresh");

    // ── Step 7.7: browser back/forward keeps Builder on its canonical surface ──
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const backUrl = page.url();
    step("back_forward_stable",
      backUrl.includes("/studio") && backUrl.includes(projectId ?? "\0"),
      `goBack → ${backUrl.replace(BASE, "")}`);

    // ── Step 7.7b: preview still serves after the refresh ──
    // API-level probe — the iframe itself may not have re-materialized yet.
    const prevProbe = projectId
      ? await page.request.get(`${BASE}/api/studio-projects/${projectId}/preview`, { timeout: 60_000 }).catch(() => null)
      : null;
    const prevBody = prevProbe ? await prevProbe.json().catch(() => null) : null;
    step("preview_recovers_after_refresh",
      !!prevProbe && prevProbe.status() === 200 &&
        !!(prevBody?.previewUrl || prevBody?.runtimeStatus === "ready" || prevBody?.runtimeStatus === "running" || prevBody?.runtimeStatus === "starting"),
      `GET /preview → ${prevProbe?.status() ?? "unreachable"} ${JSON.stringify(prevBody)?.slice(0, 160)}`);

    // ── Step 7.8: no stale approval card left after run resolution ──
    // A resolved run must not leave an actionable Approve/Deny card behind.
    const staleApprove = await page.getByTestId("approval-approve").first().isVisible().catch(() => false);
    const staleDeny = await page.getByTestId("approval-deny").first().isVisible().catch(() => false);
    step("no_stale_approval", !staleApprove && !staleDeny,
      staleApprove || staleDeny ? `actionable approval card still visible (approve=${staleApprove} deny=${staleDeny})` : "none");

    // ── Step 8: post-build mobile usability re-check ──
    // An approval resolved out-of-band (this script approves via the API, not
    // the in-page button) converges through the client's read-only approval
    // watcher, which polls the paused-run status on an interval. Assert the
    // composer becomes usable within a bounded settle window — still fails if
    // the surface never returns to Chat — rather than requiring the flip to
    // land before this script's own status poll.
    //
    // After the refresh/goBack the transient LiTT sheet is closed (correct),
    // and the cookie-consent dialog may have re-rendered over the trigger —
    // both observed in the 2026-09-16 run. Dismiss + re-open, then assert.
    await page.setViewportSize(KEYBOARD_VIEWPORT);
    await dismissCookieConsent(page);
    const commandInput = page.getByTestId("studio-command-input");
    let stillUsable = false;
    let sheetUp = false;
    const usableDeadline = Date.now() + 15_000;
    while (Date.now() < usableDeadline) {
      sheetUp = await page.getByTestId("litt-mobile-sheet").isVisible().catch(() => false);
      if (!sheetUp) {
        await openMobileSheet(page).catch(() => {});
      }
      stillUsable = await commandInput.isVisible().catch(() => false);
      if (stillUsable && sheetUp) break;
      await page.waitForTimeout(500);
    }
    if (stillUsable) {
      await commandInput.focus().catch(() => {});
    }
    step("post_build_keyboard_usable", stillUsable && sheetUp, `input=${stillUsable} sheet=${sheetUp}`);
    await shot(page, "08-post-build-keyboard");

    // Finish the mobile acceptance contract with an actual follow-up sent
    // through the reopened composer, not just a visibility assertion.
    if (stillUsable && sheetUp) {
      const followUp = "Confirm the site is ready and summarize the files you created.";
      await commandInput.fill(followUp);
      const followUpResponse = page.waitForResponse((response) =>
        /\/api\/studio\/conversations\/[^/]+\/messages/.test(response.url()) &&
        response.request().method() === "POST",
        { timeout: 60_000 },
      ).catch(() => null);
      await page.getByTestId("studio-send-button").click().catch(() => {});
      const followUpResult = await followUpResponse;
      step("post_build_follow_up_submitted", !!followUpResult && followUpResult.status() === 200,
        followUpResult ? `POST follow-up → ${followUpResult.status()}` : "follow-up messages POST not observed");
    } else {
      step("post_build_follow_up_submitted", false, "composer was not usable after the drawer was closed and LiTT was reopened");
    }

    // Verify the generated site from a real desktop viewport as well. This
    // is deliberately a separate browser page so the mobile composer proof
    // remains independent of responsive reflow.
    if (verdict.liveDeploymentUrl) {
      const desktopPage = await context.newPage();
      await desktopPage.setViewportSize({ width: 1440, height: 900 });
      const desktopResp = await desktopPage.goto(verdict.liveDeploymentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null);
      const desktopBody = await desktopPage.locator("body").innerText().catch(() => "");
      step("desktop_generated_site", desktopResp?.status() === 200 && /ember roast/i.test(desktopBody),
        `HTTP ${desktopResp?.status() ?? "unreachable"} body=${desktopBody.length}b`);
      await desktopPage.close().catch(() => {});
    } else {
      step("desktop_generated_site", false, "no live deployment URL to verify");
    }

  } catch (err) {
    step("fatal", false, err instanceof Error ? err.message : String(err));
    await shot(page, "99-fatal");
  }

  // Final verdict
  const failed = Object.entries(verdict.steps).filter(([, v]) => !v.ok).map(([k]) => k);
  verdict.verdict = failed.length === 0 ? "PASS" : `FAIL: ${failed.join(", ")}`;
  verdict.finishedAt = new Date().toISOString();
  writeFileSync(path.join(ARTIFACT_DIR, "verdict.json"), JSON.stringify(verdict, null, 2));
  console.log(`\n=== VERDICT: ${verdict.verdict} ===`);
  console.log(`Artifacts: ${ARTIFACT_DIR}`);

  await context.close();
  await browser.close();

  // Fail the GitHub Actions step after artifacts are written and browser cleanup completes.
  process.exitCode = exitCodeForVerdict(verdict);
}

main().catch((err) => {
  console.error("RUNNER ERROR:", err);
  verdict.verdict = "RUNNER_ERROR";
  writeFileSync(path.join(ARTIFACT_DIR, "verdict.json"), JSON.stringify(verdict, null, 2));
  process.exit(1);
});
