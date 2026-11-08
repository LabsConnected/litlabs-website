#!/usr/bin/env node
/**
 * project-switch-mobile.mjs — explicit mobile project-switching verification.
 *
 * The golden journey covers one project end-to-end but never exercises
 * switching between projects. This script closes that gap:
 *
 *   staging health → fresh Clerk TEST user → sign_in_token session
 *   → create project A + project B (blank, no AI calls — $0 spend)
 *   → mobile (Pixel 7) load /studio?project=A → assert A context
 *   → switch to /studio?project=B → assert B context (and A absent)
 *   → switch back to A → assert A restored
 *   → API isolation: both projects listed, distinct ids, zero cross-files
 *
 * No model calls are made — project creation and navigation are free-tier
 * API/UI operations only.
 *
 * Usage:
 *   node scripts/final-acceptance/project-switch-mobile.mjs --env-file=.env.local
 *
 * Env: CLERK_SECRET_KEY (or --env-file containing it), LITT_PROD_BASE_URL
 * (defaults to staging), LITT_ACCEPTANCE_USER_ID (optional — mints a fresh
 * Clerk TEST user inline when absent).
 */
import { chromium, devices } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.LITT_PROD_BASE_URL ?? "https://litlabslitt-shell-staging.up.railway.app").replace(/\/$/, "");
const ARTIFACT_DIR = path.join("artifacts", "final-acceptance", `project-switch-${Date.now()}`);
const SHOT_DIR = path.join(ARTIFACT_DIR, "screens");
mkdirSync(SHOT_DIR, { recursive: true });

const NAME_A = `Switch Alpha ${Date.now().toString(36)}`;
const NAME_B = `Switch Beta ${Date.now().toString(36)}`;

const verdict = {
  base: BASE,
  startedAt: new Date().toISOString(),
  steps: {},
  consoleErrors: [],
  pageErrors: [],
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

function loadSecret() {
  if (process.env.CLERK_SECRET_KEY) return process.env.CLERK_SECRET_KEY;
  const envFile = process.argv.find((a) => a.startsWith("--env-file="))?.split("=")[1];
  if (envFile && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf-8").split("\n")) {
      const m = line.match(/^\s*CLERK_SECRET_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("CLERK_SECRET_KEY not found in env or --env-file");
}

let USER_ID = process.env.LITT_ACCEPTANCE_USER_ID;
if (!USER_ID) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const resp = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${loadSecret()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: [`litt-switch-${stamp}@litlabs.net`],
      first_name: "LiTT",
      last_name: "SwitchTest",
      public_metadata: { littAcceptance: true, kind: "project-switch", createdAt: new Date().toISOString() },
      skip_password_requirement: true,
    }),
  });
  if (!resp.ok) throw new Error(`fresh-user creation failed: HTTP ${resp.status}`);
  USER_ID = (await resp.json()).id;
  if (!/^user_[A-Za-z0-9]+$/.test(USER_ID ?? "")) throw new Error("no valid user id returned");
}
verdict.userId = USER_ID;

async function createSignInToken(secretKey) {
  const resp = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID, expires_in_seconds: 600 }),
  });
  if (!resp.ok) throw new Error(`sign_in_tokens failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.token) throw new Error("sign_in_tokens response missing token");
  return data.token;
}

async function apiGet(page, apiPath) {
  return page.evaluate(async (p) => {
    const r = await fetch(p, { credentials: "same-origin" });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, apiPath);
}

async function apiPost(page, apiPath, data) {
  return page.evaluate(async ({ p, d }) => {
    const r = await fetch(p, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, { p: apiPath, d: data });
}

/** Wait for the studio page to settle and return which project context it shows. */
async function readStudioContext(page) {
  // The project store hydrates async — give the name a chance to render.
  await page.waitForTimeout(4_000);
  return page.evaluate(() => {
    const params = new URL(window.location.href).searchParams;
    const body = document.body?.innerText ?? "";
    return { projectParam: params.get("project"), bodyText: body.slice(0, 4000) };
  });
}

async function main() {
  // ── Step 0: staging health ──
  const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(30_000) })
    .then((r) => r.json()).catch(() => null);
  const healthOk = health?.status === "ok";
  step("staging_health", healthOk, health ? `commit=${health.commit}` : "unreachable");
  if (!healthOk) throw new Error("staging unhealthy — refusing run");

  const signInToken = await createSignInToken(loadSecret());
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();

  page.on("console", (m) => { if (m.type() === "error") verdict.consoleErrors.push(m.text().slice(0, 400)); });
  page.on("pageerror", (e) => verdict.pageErrors.push(String(e).slice(0, 400)));
  page.on("response", (r) => { if (/\/api\//.test(r.url())) verdict.networkSummary.push({ status: r.status(), url: r.url().replace(BASE, "") }); });

  try {
    // ── Step 1: mobile sign-in ──
    const baseOrigin = new URL(BASE).origin;
    await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(signInToken)}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForURL((u) => {
      const x = new URL(u);
      return x.origin === baseOrigin && !x.pathname.startsWith("/sign-in");
    }, { timeout: 60_000 });
    const list0 = await apiGet(page, "/api/studio-projects");
    step("sign_in", list0.status === 200, `GET /api/studio-projects → ${list0.status}`);
    if (list0.status !== 200) throw new Error(`auth probe failed: ${list0.status}`);
    const baselineCount = Array.isArray(list0.body?.projects) ? list0.body.projects.length : 0;
    verdict.notes.push(`baseline projects=${baselineCount} (reused user when Clerk quota blocks fresh mint)`);

    // ── Step 2: user provisioning wait (Clerk webhook → users row) ──
    // /api/wallet lazy-provisions after #831; pre-#831 staging still needs the
    // webhook to land first. Either way this poll converges on a live row.
    let wallet = null;
    const provDeadline = Date.now() + 90_000;
    while (Date.now() < provDeadline) {
      const res = await apiGet(page, "/api/wallet");
      if (res.status === 200) { wallet = res; break; }
      wallet = res;
      await page.waitForTimeout(3_000);
    }
    step("user_provisioning", wallet?.status === 200,
      wallet?.status === 200 ? `users row live` : `never materialized (HTTP ${wallet?.status})`);
    if (wallet?.status !== 200) throw new Error("user provisioning failed");

    // ── Step 3: create two blank projects ──
    const mkA = await apiPost(page, "/api/studio-projects", { sourceType: "blank", name: NAME_A, templateId: "empty-static" });
    const mkB = await apiPost(page, "/api/studio-projects", { sourceType: "blank", name: NAME_B, templateId: "empty-static" });
    const idA = mkA.body?.project?.id ?? mkA.body?.id ?? null;
    const idB = mkB.body?.project?.id ?? mkB.body?.id ?? null;
    step("create_two_projects", mkA.status === 201 && mkB.status === 201 && !!idA && !!idB && idA !== idB,
      `A=${idA} (${mkA.status}) B=${idB} (${mkB.status})`);
    if (!idA || !idB) throw new Error("project creation failed");

    // ── Step 4: list shows exactly these two ──
    const list1 = await apiGet(page, "/api/studio-projects");
    const projects = Array.isArray(list1.body?.projects) ? list1.body.projects : [];
    const hasA = projects.some((p) => p.id === idA);
    const hasB = projects.some((p) => p.id === idB);
    step("project_list_contains_both", list1.status === 200 && hasA && hasB && projects.length === baselineCount + 2,
      `listed=${projects.length} (baseline ${baselineCount} + 2) hasA=${hasA} hasB=${hasB}`);

    // ── Step 5: open studio on project A (mobile) ──
    await page.goto(`${BASE}/studio?project=${idA}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const ctxA = await readStudioContext(page);
    const showsA = ctxA.projectParam === idA && ctxA.bodyText.includes(NAME_A);
    const leaksB = ctxA.bodyText.includes(NAME_B);
    step("studio_loads_A", ctxA.projectParam === idA, `project param=${ctxA.projectParam}`);
    step("ui_shows_A_context", showsA && !leaksB,
      `name visible=${ctxA.bodyText.includes(NAME_A)} B leaked=${leaksB}`);
    await shot(page, "studio-A");

    // ── Step 6: switch to project B ──
    await page.goto(`${BASE}/studio?project=${idB}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const ctxB = await readStudioContext(page);
    const showsB = ctxB.projectParam === idB && ctxB.bodyText.includes(NAME_B);
    const leaksA = ctxB.bodyText.includes(NAME_A);
    step("switch_to_B", ctxB.projectParam === idB, `project param=${ctxB.projectParam}`);
    step("ui_shows_B_context_no_A", showsB && !leaksA,
      `name visible=${ctxB.bodyText.includes(NAME_B)} A leaked=${leaksA}`);
    await shot(page, "studio-B");

    // ── Step 7: switch back to A — context restored ──
    await page.goto(`${BASE}/studio?project=${idA}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const ctxA2 = await readStudioContext(page);
    step("switch_back_to_A", ctxA2.projectParam === idA && ctxA2.bodyText.includes(NAME_A),
      `project param=${ctxA2.projectParam} name visible=${ctxA2.bodyText.includes(NAME_A)}`);
    await shot(page, "studio-A-return");

    // ── Step 8: API-side isolation — each project resolves to itself ──
    const getA = await apiGet(page, `/api/studio-projects/${idA}`);
    const getB = await apiGet(page, `/api/studio-projects/${idB}`);
    const nameA = getA.body?.project?.name ?? getA.body?.name;
    const nameB = getB.body?.project?.name ?? getB.body?.name;
    step("api_isolation", getA.status === 200 && getB.status === 200 && nameA === NAME_A && nameB === NAME_B,
      `A→"${nameA}" B→"${nameB}"`);

    // Files isolation: both fresh projects must have zero user files and not
    // be able to read each other's workspace. The endpoint returns {entries:[]}
    // (same contract the golden journey asserts); .git is not a user file.
    const filesA = await apiGet(page, `/api/studio-projects/${idA}/files?path=${encodeURIComponent(".")}`);
    const filesB = await apiGet(page, `/api/studio-projects/${idB}/files?path=${encodeURIComponent(".")}`);
    const userEntries = (b) => Array.isArray(b?.entries) ? b.entries.filter((e) => e?.name !== ".git").length
      : Array.isArray(b?.files) ? b.files.filter((e) => e?.name !== ".git").length : -1;
    const countA = userEntries(filesA.body);
    const countB = userEntries(filesB.body);
    step("files_isolated", filesA.status === 200 && filesB.status === 200 && countA === 0 && countB === 0,
      `A userFiles=${countA} (${filesA.status}) B userFiles=${countB} (${filesB.status})`);

    // Console noise that is correct-by-design for a fresh non-owner user with
    // unbuilt projects: /api/owner/test-mode 403 (owner gate working) and
    // /api/preview/<id>/index.html 404 (nothing built yet). Console errors
    // carry no URL, so reconcile counts against the network log instead.
    const benign4xx = verdict.networkSummary.filter((n) =>
      n.status === 403 && n.url === "/api/owner/test-mode" ||
      n.status === 404 && /\/api\/preview\/[0-9a-f-]+\/index\.html/.test(n.url),
    ).length;
    const resourceErrs = verdict.consoleErrors.filter((e) => /Failed to load resource/.test(e)).length;
    const otherErrs = verdict.consoleErrors.filter((e) => !/Failed to load resource/.test(e));
    step("no_console_errors", otherErrs.length === 0 && resourceErrs <= benign4xx,
      `resourceErrs=${resourceErrs} benign4xx=${benign4xx} other=${otherErrs.length}${otherErrs[0] ? " first=" + otherErrs[0].slice(0, 160) : ""}`);

    const failed = Object.entries(verdict.steps).filter(([, v]) => !v.ok).map(([k]) => k);
    verdict.verdict = failed.length === 0 ? "PASS" : `FAIL: ${failed.join(", ")}`;
  } catch (err) {
    step("fatal", false, String(err).slice(0, 300));
    verdict.verdict = `FAIL: ${String(err).slice(0, 200)}`;
    await shot(page, "fatal").catch(() => {});
  } finally {
    verdict.finishedAt = new Date().toISOString();
    writeFileSync(path.join(ARTIFACT_DIR, "verdict.json"), JSON.stringify(verdict, null, 2));
    console.log(`\n=== VERDICT: ${verdict.verdict} ===\nartifacts: ${ARTIFACT_DIR}`);
    await browser.close().catch(() => {});
  }
}

await main();
process.exitCode = verdict.verdict === "PASS" ? 0 : 1;
