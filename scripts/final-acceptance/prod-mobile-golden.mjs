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
const PROMPT =
  process.env.LITT_ACCEPTANCE_PROMPT ||
  (DEPLOY_REQUESTED
    ? "Build a simple single-page landing site for a coffee roastery called Ember Roast with a hero, a menu section, and a contact section, then deploy it live."
    : "Build a simple single-page landing site for a coffee roastery called Ember Roast with a hero, a menu section, and a contact section.");

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
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

    // ── Step 1.5: create a fresh blank project + provision workspace ──
    // Same endpoints the Studio UI calls ("Start Blank Project" → POST
    // /api/studio-projects; "Prepare" → POST /workspace/prepare).
    const projResp = await page.request.post(`${BASE}/api/studio-projects`, {
      data: { sourceType: "blank", name: `Ember Roast V1 Acceptance ${STAMP.slice(11)}`, templateId: "blank-static" },
      timeout: 60_000,
    });
    const projBody = await projResp.json().catch(() => null);
    const projectId = projBody?.project?.id ?? null;
    step("project_created", projResp.status() === 201 && !!projectId, `HTTP ${projResp.status()} id=${projectId}`);

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
    await page.getByRole("button", { name: "Ask LiTT to build" }).click({ timeout: 15_000 });
    await page.getByTestId("litt-mobile-sheet").waitFor({ state: "visible", timeout: 15_000 });
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

    // ── Step 7: deploy (if ship routing engaged) ──
    const deployResult = events.find((e) => e.type === "deploy_result");
    const deployVerify = events.find((e) => e.type === "deploy_verify");
    const productionUrl = deployResult?.productionUrl || deployVerify?.url || null;
    if (DEPLOY_REQUESTED) {
      if (deployResult) {
        step("deploy_result", deployResult.success === true, deployResult.success ? `url=${productionUrl}` : `error=${deployResult.error}`);
        if (productionUrl) {
          const prodResp = await page.request.get(productionUrl, { timeout: 45_000 }).catch(() => null);
          const prodStatus = prodResp?.status() ?? -1;
          const prodBody = prodResp ? await prodResp.text().catch(() => "") : "";
          step("production_url_verified", prodStatus === 200 && prodBody.length > 100,
            `GET ${productionUrl} → ${prodStatus} (${prodBody.length}b)${deployVerify ? `; flow verify=${deployVerify.success}` : ""}`);
        } else {
          step("production_url_verified", false, "no productionUrl in events");
        }
      } else {
        verdict.notes.push("Deploy requested in prompt but no deploy_result event — routing likely stayed in non-ship mode.");
        step("deploy_result", false, "no deploy_result event in stream");
      }
    } else {
      verdict.notes.push("Deploy not requested (LITT_ACCEPTANCE_DEPLOY=0).");
    }

    // ── Step 8: post-build mobile usability re-check ──
    await page.getByTestId("studio-command-input").focus().catch(() => {});
    await page.setViewportSize(KEYBOARD_VIEWPORT);
    await page.waitForTimeout(600);
    const stillUsable = await page.getByTestId("studio-command-input").isVisible().catch(() => false);
    const sheetUp = await page.getByTestId("litt-mobile-sheet").isVisible().catch(() => false);
    step("post_build_keyboard_usable", stillUsable && sheetUp, `input=${stillUsable} sheet=${sheetUp}`);
    await shot(page, "08-post-build-keyboard");

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
