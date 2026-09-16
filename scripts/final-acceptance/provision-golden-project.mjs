/**
 * One-time provisioning for the permanent golden acceptance project.
 *
 * Signs in as the acceptance QA user (same Clerk sign_in_token flow as
 * prod-mobile-golden.mjs), creates "Golden Acceptance — Ember Roast",
 * prepares its workspace, and writes the seed index.html that every
 * subsequent golden run edits. Prints the project ID at the end so it can
 * be registered as the LITT_GOLDEN_PROJECT_ID repository secret.
 *
 * Runs only via the final-acceptance-golden workflow's provision_only
 * dispatch input — the acceptance user id lives in repository secrets.
 *
 *   CLERK_SECRET_KEY=... LITT_ACCEPTANCE_USER_ID=... \
 *     node scripts/final-acceptance/provision-golden-project.mjs
 */

import { chromium } from "@playwright/test";
import { resolveAcceptanceUserId } from "./acceptance-user.mjs";

const BASE = (process.env.LITT_PROD_BASE_URL || "https://www.litlabs.net").replace(/\/$/, "");
const USER_ID = resolveAcceptanceUserId({
  isCI: process.env.GITHUB_ACTIONS === "true",
  envUserId: process.env.LITT_ACCEPTANCE_USER_ID,
});
const PROJECT_NAME = "Golden Acceptance — Ember Roast";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
if (!CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY not set");

// The seed site every golden run mutates. The footer carries the slot the
// run's stamped literal lands in.
const SEED_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ember Roast — Premium Coffee Roasters</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #1a120b; color: #f5ede3; }
    header.hero { padding: 96px 24px; text-align: center; }
    header.hero h1 { font-size: 2.5rem; margin: 0 0 12px; }
    section { max-width: 640px; margin: 0 auto; padding: 40px 24px; }
    h2 { color: #e3b341; }
    footer { text-align: center; padding: 32px 24px; color: #a89880; font-size: 0.875rem; }
  </style>
</head>
<body>
  <header class="hero">
    <h1>Ember Roast</h1>
    <p>Premium coffee, roasted in small batches.</p>
  </header>
  <section id="menu">
    <h2>Menu</h2>
    <ul>
      <li>Ember Blend — dark roast</li>
      <li>First Light — light roast</li>
      <li>Midnight Pour — cold brew</li>
    </ul>
  </section>
  <section id="contact">
    <h2>Contact</h2>
    <p>Visit us at the roastery or write to hello@emberroast.example.</p>
  </section>
  <footer>&copy; Ember Roast. All rights reserved.</footer>
</body>
</html>
`;

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

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const signInUrl = await createSignInUrl(CLERK_SECRET_KEY);
  await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForURL(/litlabs\.net/, { timeout: 60_000 });
  await page.waitForTimeout(4000);
  const authProbe = await page.request.get(`${BASE}/api/studio-projects`, { timeout: 60_000 });
  if (authProbe.status() !== 200) throw new Error(`auth failed: /api/studio-projects → ${authProbe.status()}`);

  // Idempotent: reuse the existing project if one already carries the name.
  const listBody = await authProbe.json().catch(() => null);
  const existing = (listBody?.projects ?? []).find((p) => p.name === PROJECT_NAME);
  let projectId = existing?.id ?? null;
  if (projectId) {
    console.log(`Reusing existing project ${projectId}`);
  } else {
    const resp = await page.request.post(`${BASE}/api/studio-projects`, {
      data: { sourceType: "blank", name: PROJECT_NAME, templateId: "blank-static" },
      timeout: 60_000,
    });
    const body = await resp.json().catch(() => null);
    projectId = body?.project?.id ?? null;
    if (resp.status() !== 201 || !projectId) {
      throw new Error(`project create failed: HTTP ${resp.status()} ${JSON.stringify(body)?.slice(0, 200)}`);
    }
    console.log(`Created project ${projectId}`);
  }

  const prep = await page.request.post(`${BASE}/api/studio-projects/${projectId}/workspace/prepare`, { timeout: 120_000 });
  const prepBody = await prep.json().catch(() => null);
  console.log(`workspace/prepare → ${prep.status()} ${JSON.stringify(prepBody)?.slice(0, 200)}`);

  const write = await page.request.post(`${BASE}/api/studio-projects/${projectId}/files`, {
    data: { action: "write", path: "index.html", content: SEED_INDEX_HTML },
    timeout: 60_000,
  });
  if (!write.ok()) throw new Error(`seed index.html write failed: HTTP ${write.status()}`);
  console.log("Seeded index.html");

  // Read-back proves the workspace actually holds the file.
  const raw = await page.request.get(`${BASE}/api/studio-projects/${projectId}/files/raw?path=index.html`, { timeout: 60_000 });
  const body = await raw.text().catch(() => "");
  if (!raw.ok() || !body.includes("Ember Roast")) {
    throw new Error(`seed read-back failed: HTTP ${raw.status()}`);
  }
  console.log("Read-back verified: index.html contains Ember Roast");

  await context.close();
  await browser.close();

  console.log(`\n=== GOLDEN PROJECT ID: ${projectId} ===`);
  console.log("Register it as the LITT_GOLDEN_PROJECT_ID repository secret.");
}

main().catch((err) => {
  console.error("PROVISION FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
