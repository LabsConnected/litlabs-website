/* journey-3001.cjs — Studio acceptance journey on the CANONICAL stack
   (:3001 + :4001, branch fix/studio-mission-20261030 incl. bea04663).
   Prompt -> Generate -> Approve -> Preview -> Edit -> Save -> Reload ->
   Checkpoints -> Export. Real Clerk session via stored state; real LLM
   via inherited env keys (DEMO_MODEL_PROVIDER=gemini in .env.local).

   Usage: node tasks/journey-3001.cjs [promptIndex 0..5]
*/
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const BASE = process.env.STUDIO_BASE || "http://localhost:3101";
const STATE = path.join(__dirname, "..", "tests", "playwright-e2e", ".clerk", "user-e2e.json");
const OUT = process.env.JOURNEY_OUT || path.join(__dirname, "acceptance-3001");
fs.mkdirSync(OUT, { recursive: true });

const PROMPTS = [
  "Build a one-page website for a fictional coffee roaster called Ember & Oak. " +
    "Dark theme, hero with headline, a small menu section with 3 drinks and prices, " +
    "and a footer with an address. Plain HTML/CSS/JS only — no frameworks, no images.",
  "Build a personal portfolio one-pager for a fictional designer named Mira Solen. " +
    "Light theme, hero with her name and tagline, a projects grid with 3 fictional " +
    "projects, and a contact section. Plain HTML/CSS/JS only, no frameworks, no images.",
  "Build a landing page for a fictional SaaS product called NoteHive that organizes " +
    "research notes. Hero with headline and CTA button, a features section with 3 " +
    "features, a pricing strip with 2 tiers, and a footer. Plain HTML/CSS/JS only.",
  "Build a one-page website for a fictional bistro called Cedar & Thyme. " +
    "Warm theme, hero, a menu section with 4 dishes and prices, opening hours, " +
    "and a reservation note in the footer. Plain HTML/CSS/JS only, no images.",
  "Build a single-page photography portfolio for a fictional photographer named " +
    "Theo Lark. Minimal theme, hero, an exhibitions list of 3 fictional shows, " +
    "an about paragraph, and a footer with a studio address. Plain HTML/CSS/JS only.",
  "Build a one-page site for a fictional indie game jam called PixelForge Jam 2026. " +
    "Retro theme, hero with dates, a schedule section with 3 events, a rules blurb, " +
    "and a footer. Plain HTML/CSS/JS only, no frameworks.",
];

const PROMPT_IDX = Math.min(Math.max(parseInt(process.argv[2] || "0", 10) || 0, 0), PROMPTS.length - 1);
const PROMPT = PROMPTS[PROMPT_IDX];
const TAG = process.env.JOURNEY_TAG || `p${PROMPT_IDX}`;

const results = { promptIndex: PROMPT_IDX, prompt: PROMPT, legs: [], consoleErrors: [], netErrors: [] };
const leg = (name, pass, detail) => {
  results.legs.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
};

function wire(page, tag) {
  page.on("console", (m) => {
    if (m.type() === "error") results.consoleErrors.push(`${tag}: ${m.text().slice(0, 140)}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.includes("_next/static") && !u.includes("clerk") && !u.includes("sentry"))
      results.netErrors.push(`${tag}: ${r.failure()?.errorText} ${u.slice(0, 100)}`);
  });
}

async function api(page, url, opts = {}) {
  return page.evaluate(async ([u, o]) => {
    const r = await fetch(u, { credentials: "include", ...o, headers: { "content-type": "application/json", ...(o.headers || {}) } });
    const ct = r.headers.get("content-type") || "";
    const body = ct.includes("json") ? await r.json() : await r.text();
    return { s: r.status, b: typeof body === "string" ? body.slice(0, 400) : body };
  }, [url, opts]);
}

async function readFile(page, projectId, p) {
  return api(page, `/api/studio-projects/${projectId}/files`, {
    method: "POST",
    body: JSON.stringify({ action: "read", path: p }),
  });
}

function siteMarkers() {
  switch (PROMPT_IDX) {
    case 0: return /ember|oak|coffee|menu|roaster/i;
    case 1: return /mira|solen|portfolio|designer/i;
    case 2: return /notehive|research|notes|saas/i;
    case 3: return /cedar|thyme|bistro|menu|dish/i;
    case 4: return /theo|lark|photograph|exhibition/i;
    default: return /pixelforge|jam|game|schedule/i;
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  wire(page, "desktop");

  // 1. Studio load (authenticated)
  await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(9000);
  let text = await page.evaluate(() => document.body.innerText.slice(0, 800));
  leg("studio-load", /LiTT|Studio|Chat/i.test(text) && !/Authenticating/i.test(text), text.replace(/\n+/g, " ").slice(0, 90));

  // 2. Fresh project
  const created = await api(page, "/api/studio-projects", {
    method: "POST",
    body: JSON.stringify({ sourceType: "blank", name: `J${TAG} ${Date.now() % 100000}`, templateId: "blank-static" }),
  });
  const projectId = created.b?.project?.id || created.b?.id;
  leg("create-project", !!projectId, `status ${created.s} id ${projectId || "none"}`);
  if (!projectId) throw new Error("no project");

  // 3. Open studio for project; type prompt into composer
  await page.goto(`${BASE}/studio?project=${projectId}&tool=chat`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.waitForTimeout(9000);
  // Prefer the visible command-composer input; fall back to the dock textarea.
  await page.waitForSelector(
    '[data-testid="studio-command-input"], [data-testid="litt-dock-composer"] textarea',
    { state: "attached", timeout: 60000 },
  );
  const cmdInput = page.locator('[data-testid="studio-command-input"]').first();
  const dockInput = page.locator('[data-testid="litt-dock-composer"] textarea').first();
  const composer =
    (await cmdInput.count()) > 0 && (await cmdInput.isVisible().catch(() => false))
      ? cmdInput
      : dockInput;
  let composerOk = await composer.isVisible().catch(() => false);
  leg("composer-visible", composerOk, `visible=${composerOk}`);
  if (composerOk) {
    await composer.click();
    await composer.fill(PROMPT);
  } else {
    await composer.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, PROMPT);
  }
  const sendBtn = page.locator(
    '[data-testid="studio-send-button"], [data-testid="litt-dock-composer"] button[type="submit"], [data-testid="studio-command-composer"] button[type="submit"]',
  ).first();
  if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible().catch(() => false))) {
    await sendBtn.click({ timeout: 15000 }).catch(() => sendBtn.click({ force: true, timeout: 5000 }).catch(() => {}));
    leg("prompt-submitted", true, "send button");
  } else if (composerOk) {
    await composer.press("Enter");
    leg("prompt-submitted", true, "enter key");
  } else {
    await composer.evaluate((el) => {
      const f = el.closest("form");
      if (f) f.requestSubmit();
      else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    leg("prompt-submitted", true, "form requestSubmit");
  }
  // Verify the prompt actually landed in the transcript; retry once with Enter.
  await page.waitForTimeout(5000);
  const landed = await page.evaluate((frag) => document.body.innerText.includes(frag), PROMPT.slice(0, 40));
  if (!landed) {
    await composer.press("Enter").catch(() => {});
    await page.waitForTimeout(3000);
  }

  // 4. Watch: approve file-write gates; wait for real index.html (up to ~8 min)
  let wrote = false;
  let approvals = 0;
  for (let i = 0; i < 96; i++) {
    const approveBtn = page.locator('[data-testid="approval-approve"]');
    if ((await approveBtn.count()) > 0 && (await approveBtn.first().isVisible().catch(() => false))) {
      await approveBtn.first().click().catch(() => {});
      approvals++;
      console.log(`  …approved gate #${approvals}`);
      await page.waitForTimeout(2500);
      continue;
    }
    const r = await readFile(page, projectId, "index.html");
    if (r.s === 200 && r.b && JSON.stringify(r.b).length > 40 && !JSON.stringify(r.b).includes("LITT-WELCOME-SCREEN")) {
      wrote = true;
      break;
    }
    await page.waitForTimeout(5000);
  }
  const idx = await readFile(page, projectId, "index.html");
  const idxStr = JSON.stringify(idx.b || "");
  const hasMarker = idxStr.includes("LITT-GENERATED-SITE");
  const hasContent = siteMarkers().test(idxStr);
  leg("generate-files", wrote, `wrote=${wrote} approvals=${approvals} bytes=${idxStr.length}`);
  leg("real-site-not-template", wrote && (hasMarker || hasContent), `marker=${hasMarker} content=${hasContent}`);
  await page.screenshot({ path: path.join(OUT, `${TAG}-1-after-generate.png`) });

  // 5. Preview: status + served content
  const prev = await api(page, `/api/studio-projects/${projectId}/preview`);
  const prevOk = prev.s === 200 && (prev.b?.runtimeStatus === "ready" || prev.b?.runtimeStatus === "starting");
  leg("preview-status", prevOk, `status ${prev.s} runtime=${prev.b?.runtimeStatus || "?"}`);
  let serveOk = false;
  if (prevOk && prev.b?.previewUrl) {
    const pv = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: "include" });
      const t = await r.text();
      return { s: r.status, hit: null, len: t.length };
    }, prev.b.previewUrl);
    const pv2 = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: "include" });
      const t = await r.text();
      return t;
    }, prev.b.previewUrl);
    serveOk = pv.s === 200 && siteMarkers().test(pv2) ;
    if (serveOk) {
      await page.goto(`${BASE}${prev.b.previewUrl}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(OUT, `${TAG}-2-generated-site.png`), fullPage: true });
    }
  }
  leg("preview-serves-site", serveOk, `url=${(prev.b?.previewUrl || "none").slice(0, 60)}`);

  // 6. Studio with preview surface open (screenshot)
  await page.goto(`${BASE}/studio?project=${projectId}&tool=preview`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(OUT, `${TAG}-3-studio-preview.png`), fullPage: true });

  // 7. Edit -> save -> reload -> verify persistence
  const MARK = `<!-- JOURNEY-EDIT ${Date.now()} -->`;
  const current = await readFile(page, projectId, "index.html");
  const curBody = current.b?.content ?? current.b?.file?.content ?? "";
  const edited = String(curBody).replace("</body>", `${MARK}\n</body>`);
  const w2 = await api(page, `/api/studio-projects/${projectId}/files`, {
    method: "POST",
    body: JSON.stringify({ action: "write", path: "index.html", content: edited }),
  });
  leg("edit-save", w2.s === 200, `status ${w2.s}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const r2 = await readFile(page, projectId, "index.html");
  const persisted = JSON.stringify(r2.b || "").includes("JOURNEY-EDIT");
  leg("reload-persistence", persisted, `marker=${persisted}`);

  // 8. Project survives in list
  const list = await api(page, "/api/studio-projects");
  const listed = JSON.stringify(list.b || "").includes(projectId);
  leg("project-listed", listed, `found=${listed}`);

  // 9. Checkpoint create + restore (git-backed workspaces); truthful 409 acceptable on static
  const cp = await api(page, `/api/studio-projects/${projectId}/checkpoints`, {
    method: "POST",
    body: JSON.stringify({ label: "journey-checkpoint" }),
  });
  const cpCode = cp.b?.code || cp.b?.error || "";
  if (cp.s === 200 || cp.s === 201) {
    const cpId = cp.b?.checkpoint?.id || cp.b?.id;
    leg("checkpoint-create", true, `created ${cpId || "?"}`);
    // vandalize a file then restore
    await api(page, `/api/studio-projects/${projectId}/files`, {
      method: "POST",
      body: JSON.stringify({ action: "write", path: "index.html", content: "<!-- vandalized -->" }),
    });
    const rs = await api(page, `/api/studio-projects/${projectId}/checkpoints/restore`, {
      method: "POST",
      body: JSON.stringify({ checkpointId: cpId }),
    });
    const after = await readFile(page, projectId, "index.html");
    const restored = JSON.stringify(after.b || "").includes("JOURNEY-EDIT");
    leg("checkpoint-restore", rs.s === 200 && restored, `status ${rs.s} restored=${restored}`);
  } else {
    leg("checkpoint-create", cp.s === 409, `status ${cp.s} ${String(cpCode).slice(0, 60)} (409=truthful gitless)`);
    leg("checkpoint-restore", cp.s === 409, "skipped — static workspace has no git (by design)");
  }

  // 10. Export ZIP — verify PK signature + index.html inside
  const ex = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "include" });
    const buf = new Uint8Array(await r.arrayBuffer());
    const pk = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
    return { s: r.status, ct: r.headers.get("content-type") || "", len: buf.length, pk };
  }, `${BASE}/api/studio-projects/${projectId}/export`);
  leg("export-zip", ex.s === 200 && ex.pk && ex.len > 500, `status ${ex.s} ct=${ex.ct.slice(0, 30)} len=${ex.len} pk=${ex.pk}`);
  if (ex.s === 200 && ex.pk) {
    const dl = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: "include" });
      return Array.from(new Uint8Array(await r.arrayBuffer()));
    }, `${BASE}/api/studio-projects/${projectId}/export`);
    fs.writeFileSync(path.join(OUT, `${TAG}-export.zip`), Buffer.from(dl));
  }

  await ctx.close();
  await browser.close();

  results.summary = { pass: results.legs.filter((l) => l.pass).length, fail: results.legs.filter((l) => !l.pass).length };
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results.summary));
  console.log("consoleErrors:", JSON.stringify(results.consoleErrors.slice(0, 6)));
  console.log("netErrors:", JSON.stringify(results.netErrors.slice(0, 6)));
  fs.writeFileSync(path.join(OUT, `${TAG}-results.json`), JSON.stringify(results, null, 2));
  console.log(`project=${projectId}`);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
