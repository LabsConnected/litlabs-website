/**
 * LiTT Stripe TEST-mode checkout E2E — staging only.
 *
 * Drives a REAL Stripe test-mode purchase end to end on the staging app:
 *
 *   staging health → fresh Clerk user → sign_in_token browser session
 *   → POST /api/billing/checkout (creator_lite subscription)
 *   → HARD GATE: session id must be cs_test_* (a cs_live_* session means
 *     staging is pointed at the live Stripe account — the run aborts
 *     BEFORE any card is entered, so no real charge can happen)
 *   → Stripe-hosted Checkout page, 4242 test card, "TEST MODE" banner proof
 *   → success_url redirect back to staging
 *   → poll /api/users/<id>/plan until the subscription row is active
 *   → poll /api/wallet until the monthly grant lands — exactly once
 *   → forged-signature webhook POST must be rejected (400)
 *
 * Duplicate-webhook protection: the live proof is the exactly-once wallet
 * grant (balance equals one grant, never two). A real same-event-id replay
 * requires the Stripe signing secret or dashboard resend — neither is
 * available to this harness; the replay semantics are pinned at unit level
 * in src/__tests__/billing-state-machine.test.ts (duplicate event →
 * replayed:true, no mutations; grant_credits fault injection → 500 + retry
 * under the same idempotency key). The forged replay here additionally
 * proves unauthenticated bodies cannot inject events.
 *
 * Usage (CI):
 *   CLERK_SECRET_KEY=sk_test_... \
 *   LITT_PROD_BASE_URL=https://litlabslitt-shell-staging.up.railway.app \
 *   LITT_ACCEPTANCE_USER_ID=user_... \
 *   node scripts/final-acceptance/stripe-test-checkout.mjs
 *
 * Local (creates its own user when CLERK_SECRET_KEY is set):
 *   node scripts/final-acceptance/stripe-test-checkout.mjs --env-file .env.local
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { resolveAcceptanceUserId } from "./acceptance-user.mjs";

// ─── Config ────────────────────────────────────────────────────
const BASE = (
  process.env.LITT_PROD_BASE_URL || "https://litlabslitt-shell-staging.up.railway.app"
).replace(/\/$/, "");

// This script enters a card. Production must never be the target — even
// accidentally. The cs_test_ gate below is the second line of defense.
const PRODUCTION_HOSTS = ["https://www.litlabs.net", "https://litlabs.net"];
if (PRODUCTION_HOSTS.some((h) => BASE.startsWith(h))) {
  throw new Error(`refusing paid-checkout E2E against production host ${BASE}`);
}

const PLAN_ID = (process.env.LITT_E2E_PLAN_ID || "creator_lite").trim();
// Expected one-cycle monthly grant, from src/config/plan-entitlements.ts
// (PLAN_ENTITLEMENTS.*.monthlyBits). The workflow pins the staging SHA so
// the deployed code and this table cannot drift apart silently.
const EXPECTED_MONTHLY_BITS = {
  creator_lite: 2500,
  creator_beta: 7500,
  pro_builder_beta: 18000,
}[PLAN_ID];
if (!EXPECTED_MONTHLY_BITS) {
  throw new Error(`unsupported LITT_E2E_PLAN_ID "${PLAN_ID}" — use a subscription plan`);
}

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const ARTIFACT_DIR = path.join("artifacts", "stripe-e2e", STAMP);
const SHOT_DIR = path.join(ARTIFACT_DIR, "screenshots");
mkdirSync(SHOT_DIR, { recursive: true });

// In CI the workflow creates the disposable user and passes it via
// LITT_ACCEPTANCE_USER_ID (hard-required there). Locally, mint one inline —
// the legacy QA fallback in resolveAcceptanceUserId is a PROD user that does
// not exist on the Clerk TEST instance this script signs into.
let USER_ID = process.env.LITT_ACCEPTANCE_USER_ID;
if (!USER_ID && process.env.GITHUB_ACTIONS === "true") {
  USER_ID = resolveAcceptanceUserId({ isCI: true, envUserId: USER_ID });
}
if (!USER_ID) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const resp = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loadSecret()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: [`litt-acceptance-${stamp}@litlabs.net`],
      first_name: "LiTT",
      last_name: "Acceptance",
      public_metadata: { littAcceptance: true, createdAt: new Date().toISOString() },
      skip_password_requirement: true,
    }),
  });
  if (!resp.ok) throw new Error(`fresh-user creation failed: HTTP ${resp.status}`);
  USER_ID = (await resp.json()).id;
  if (!/^user_[A-Za-z0-9]+$/.test(USER_ID ?? "")) {
    throw new Error("fresh-user creation returned no valid user id");
  }
}

const WEBHOOK_POLL_MS = 150_000; // Stripe test-mode delivery is usually <30s; be generous.
const RECHECK_DELAY_MS = 20_000; // second wallet read proves no double grant arrives late.

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
  planId: PLAN_ID,
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

async function createSignInToken(secretKey) {
  const resp = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID, expires_in_seconds: 900 }),
  });
  if (!resp.ok) throw new Error(`sign_in_tokens failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.token) throw new Error("sign_in_tokens response missing token");
  return data.token;
}

// Authenticated same-origin JSON GET from inside the session — exercises
// the real client path (session cookie, middleware, route auth) rather
// than an admin back-channel.
async function apiGet(page, apiPath) {
  return page.evaluate(async (p) => {
    const r = await fetch(p, { credentials: "same-origin" });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, apiPath);
}

async function main() {
  // ── Step 0: staging health ──
  const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(30_000) })
    .then((r) => r.json())
    .catch(() => null);
  const healthOk = health?.status === "ok";
  step("staging_health", healthOk, health ? `status=${health.status} commit=${health.commit}` : "unreachable");
  if (!healthOk) throw new Error("staging unhealthy — refusing paid-flow run");

  const secretKey = loadSecret();
  const signInToken = await createSignInToken(secretKey);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") verdict.consoleErrors.push(msg.text().slice(0, 400));
  });
  page.on("pageerror", (err) => verdict.pageErrors.push(String(err).slice(0, 400)));
  page.on("response", (resp) => {
    if (/\/api\//.test(resp.url())) {
      verdict.networkSummary.push({ status: resp.status(), url: resp.url().replace(BASE, "") });
    }
  });

  try {
    // ── Step 1: sign in on the staging origin ──
    const baseOrigin = new URL(BASE).origin;
    await page.goto(
      `${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(signInToken)}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    await page.waitForURL(
      (url) => {
        const u = new URL(url);
        return u.origin === baseOrigin && !u.pathname.startsWith("/sign-in");
      },
      { timeout: 60_000 },
    );
    step("sign_in", true, `landed ${page.url()}`);

    // ── Step 2: user provisioning wait ──
    // The users row is created by the Clerk webhook on user.created — it is
    // NOT synchronous with sign-in. Poll /api/wallet until the row
    // materializes; a persistent 500 "Wallet user was not found" means the
    // Clerk TEST instance has no webhook endpoint aimed at this host — the
    // entire billing chain is a silent no-op without the row, so abort.
    let wallet0 = null;
    const provDeadline = Date.now() + 90_000;
    while (Date.now() < provDeadline) {
      const res = await apiGet(page, "/api/wallet");
      if (res.status === 200) { wallet0 = res; break; }
      wallet0 = res;
      await page.waitForTimeout(3_000);
    }
    step("user_provisioning", wallet0?.status === 200,
      wallet0?.status === 200
        ? `users row live — balance=${wallet0.body?.balance} monthly=${wallet0.body?.balances?.monthly} purchased=${wallet0.body?.balances?.purchased}`
        : `users row never materialized (last: HTTP ${wallet0?.status} ${wallet0?.body?.error ?? "?"}) — Clerk webhook likely not registered for staging`);
    if (wallet0?.status !== 200) {
      throw new Error("user provisioning failed — no users row after 90s");
    }
    const baselineMonthly = wallet0.body?.balances?.monthly ?? 0;

    // ── Step 3: create checkout session ──
    const checkout = await apiPost(page, "/api/billing/checkout", { planId: PLAN_ID });
    const sessionUrl = checkout.body?.url;
    const sessionId = checkout.body?.sessionId;
    step("checkout_session_created", checkout.status === 200 && !!sessionUrl && !!sessionId,
      `status=${checkout.status} sessionId=${sessionId ?? "none"}${checkout.status !== 200 ? ` error=${checkout.body?.error ?? "?"}` : ""}`);
    if (checkout.status !== 200 || !sessionUrl || !sessionId) {
      throw new Error(`checkout session failed: ${checkout.status} ${JSON.stringify(checkout.body).slice(0, 300)}`);
    }

    // ── Step 4: TEST-MODE HARD GATE ──
    // Stripe prefixes every object by mode. A cs_live_ session means the
    // staging service is holding a live secret key — paying it would be a
    // real charge. Abort BEFORE the checkout page is even opened.
    step("stripe_mode_gate", sessionId.startsWith("cs_test_"),
      sessionId.startsWith("cs_test_")
        ? `${sessionId} — staging Stripe is in TEST mode`
        : `${sessionId} — NOT a test session; staging may hold a LIVE Stripe key`);
    if (!sessionId.startsWith("cs_test_")) {
      throw new Error(`ABORT: checkout session ${sessionId} is not test-mode — refusing to open the payment page`);
    }

    // ── Step 5: Stripe-hosted checkout, test card ──
    // The checkout app hydrates asynchronously — fields take seconds to
    // mount, and newer Checkout renders them inside same-origin iframes
    // (Payment Element). Probe the top document, then every frame.
    await page.goto(sessionUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const emailSel = 'input[name="email"], #email';
    await page.locator(emailSel).first()
      .waitFor({ state: "visible", timeout: 45_000 })
      .catch(() => {});
    await page.locator(emailSel).first()
      .fill(`litt-acceptance-${STAMP}@litlabs.net`)
      .catch(() => {});

    // Some layouts gate the payment fields behind an email "Continue" step.
    const cont = page.getByRole("button", { name: /continue|next/i }).first();
    if (await cont.isVisible().catch(() => false)) {
      await cont.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Accordion payment-method layout: the card inputs only mount after the
    // "Card" option is selected. The option's accessible name includes the
    // card-brand text, so match loosely and fall back to a text-node click
    // that bubbles into the row's handler. No-op when Card is the sole method.
    let cardClicked = null;
    for (const cand of [
      page.getByRole("radio", { name: /card/i }),
      page.getByRole("option", { name: /card/i }),
      page.getByRole("button", { name: /^card$/i }),
      page.locator('[role="radio"]:has-text("Card")'),
      page.locator('[data-testid*="card"], [id*="card" i]'),
      page.getByText(/^\s*Card\s*$/),
      page.locator('label:has-text("Card")'),
    ]) {
      const el = cand.first();
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 5_000 }).then(() => { cardClicked = "locator"; }).catch(() => {});
        break;
      }
    }
    if (!cardClicked) {
      cardClicked = await page.evaluate(() => {
        const els = [...document.querySelectorAll("*")].filter(
          (e) => e.offsetParent && e.children.length === 0 && /^card$/i.test(e.textContent.trim()),
        );
        if (!els.length) return null;
        els[0].click();
        return "evaluate";
      });
    }
    await page.waitForTimeout(2000);

    const cardSel = 'input[name="cardNumber"], #cardNumber';
    const expirySel = 'input[name="cardExpiry"], #cardExpiry';
    const cvcSel = 'input[name="cardCvc"], #cardCvc';
    let cardCtx = null;
    const fieldDeadline = Date.now() + 45_000;
    while (Date.now() < fieldDeadline && !cardCtx) {
      if (await page.locator(cardSel).first().isVisible().catch(() => false)) {
        cardCtx = page;
        break;
      }
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        if (await frame.locator(cardSel).first().isVisible().catch(() => false)) {
          cardCtx = frame;
          break;
        }
      }
      if (!cardCtx) await page.waitForTimeout(1000);
    }
    if (!cardCtx) {
      const frames = page.frames().map((f) => f.url());
      const inputs = await page.locator("input")
        .evaluateAll((els) => els.map((e) => ({ id: e.id, name: e.name, type: e.type })))
        .catch(() => []);
      const radiogroup = await page.evaluate(() => {
        const g = document.querySelector('[role="radiogroup"],[role="listbox"]');
        return g ? g.outerHTML.slice(0, 4000) : null;
      }).catch(() => null);
      const paySection = await page.evaluate(() => {
        const el = [...document.querySelectorAll("div,section,fieldset,form")].find(
          (e) => e.textContent.includes("Cash App Pay") && e.textContent.length < 4000,
        );
        return el ? el.outerHTML.slice(0, 6000) : document.body.innerHTML.slice(0, 6000);
      }).catch(() => null);
      writeFileSync(path.join(ARTIFACT_DIR, "checkout-dom.json"),
        JSON.stringify({ cardClicked, frames, inputs, radiogroup, paySection }, null, 2));
      writeFileSync(path.join(ARTIFACT_DIR, "checkout-body.html"),
        await page.evaluate(() => document.body.innerHTML).catch(() => ""));
      await shot(page, "stripe-checkout-no-fields");
      throw new Error("card input not found in page or any frame (see checkout-dom.json)");
    }

    // Informational only — the cs_test_ session gate is authoritative.
    const testBadgeVisible = await page
      .getByText(/test mode|sandbox/i).first()
      .isVisible({ timeout: 15_000 }).catch(() => false);
    step("stripe_test_mode_banner", true,
      testBadgeVisible ? "TEST MODE/Sandbox marker present" : "marker not detected (sessionId gate is authoritative)");
    await shot(page, "stripe-checkout");

    await cardCtx.locator(cardSel).first().fill("4242424242424242");
    await cardCtx.locator(expirySel).first().fill("1234");
    await cardCtx.locator(cvcSel).first().fill("123");
    const nameSel = 'input[name="billingName"], #billingName';
    if (await cardCtx.locator(nameSel).first().isVisible().catch(() => false)) {
      await cardCtx.locator(nameSel).first().fill("LiTT Acceptance");
    }
    const zipSel = 'input[name="billingPostalCode"], #billingPostalCode';
    if (await cardCtx.locator(zipSel).first().isVisible().catch(() => false)) {
      await cardCtx.locator(zipSel).first().fill("10001");
    }
    step("stripe_checkout_filled", true,
      `card fields filled in ${cardCtx === page ? "document" : "iframe"} context`);
    await shot(page, "stripe-checkout-filled");

    // Stripe's Link opt-in is checked by default and demands a phone number
    // — its validation error silently blocks Subscribe. Uncheck it.
    const linkBox = page.getByRole("checkbox", { name: /save my information|link/i }).first();
    if (await linkBox.isChecked().catch(() => false)) {
      await linkBox.click().catch(() => {});
    }
    const phoneField = page.locator('input[type="tel"], input[name*="phone" i], #phoneNumber').first();
    if (await phoneField.isVisible().catch(() => false)) {
      await phoneField.fill("2015550123").catch(() => {});
    }

    const payBtn = page.getByRole("button", { name: /subscribe|pay|complete/i }).first();
    if (await payBtn.isVisible().catch(() => false)) {
      await payBtn.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }

    // ── Step 6: success redirect back to staging ──
    let redirected = false;
    try {
      await page.waitForURL(
        (url) => url.origin === baseOrigin && /upgraded=/.test(url.search),
        { timeout: 90_000 },
      );
      redirected = true;
    } catch {
      redirected = /upgraded=/.test(page.url());
    }
    await shot(page, "post-payment");
    step("payment_success_redirect", redirected, `landed ${page.url()}`);
    if (!redirected) throw new Error("payment did not redirect to the success_url");

    // ── Step 7: subscription activation via webhook ──
    // Stripe test mode delivers customer.subscription.created + invoice.paid
    // to the registered endpoint; both must land for plan + credits.
    let plan = null;
    const planDeadline = Date.now() + WEBHOOK_POLL_MS;
    while (Date.now() < planDeadline) {
      const res = await apiGet(page, `/api/users/${USER_ID}/plan`);
      if (res.status === 200 && res.body?.plan === PLAN_ID && res.body?.status === "active") {
        plan = res.body;
        break;
      }
      await page.waitForTimeout(4_000);
    }
    step("subscription_active", !!plan, plan ? `plan=${plan.plan} status=${plan.status}` : "plan did not activate in 150s — test webhook endpoint may not be registered for this host");
    writeFileSync(path.join(ARTIFACT_DIR, "plan-response.json"), JSON.stringify(plan, null, 2));

    // ── Step 8: monthly credit grant — exactly once ──
    let wallet1 = null;
    const grantDeadline = Date.now() + WEBHOOK_POLL_MS;
    while (Date.now() < grantDeadline) {
      const res = await apiGet(page, "/api/wallet");
      if (res.status === 200 && (res.body?.balances?.monthly ?? 0) >= baselineMonthly + EXPECTED_MONTHLY_BITS) {
        wallet1 = res.body;
        break;
      }
      await page.waitForTimeout(4_000);
    }
    const granted = wallet1 ? wallet1.balances.monthly - baselineMonthly : 0;
    step("credit_grant", granted === EXPECTED_MONTHLY_BITS,
      wallet1
        ? `monthly=${wallet1.balances.monthly} (baseline ${baselineMonthly}, granted ${granted}, expected ${EXPECTED_MONTHLY_BITS}) purchased=${wallet1.balances.purchased} total=${wallet1.balance}`
        : "grant did not land in 150s");

    // Exactly-once: the invoice_grant_<inv> idempotency key must prevent a
    // second grant. Re-read after a settle delay — a duplicate delivery or
    // buggy reprocessing would push monthly past the single-grant amount.
    await page.waitForTimeout(RECHECK_DELAY_MS);
    const wallet2 = (await apiGet(page, "/api/wallet")).body;
    step("credit_grant_exactly_once",
      !!wallet2 && wallet2.balances.monthly === baselineMonthly + EXPECTED_MONTHLY_BITS,
      wallet2 ? `monthly stable at ${wallet2.balances.monthly} after ${RECHECK_DELAY_MS / 1000}s recheck` : "wallet unreadable on recheck");
    writeFileSync(path.join(ARTIFACT_DIR, "wallet.json"), JSON.stringify({ baseline: wallet0.body, after: wallet1, recheck: wallet2 }, null, 2));

    // ── Step 9: webhook signature enforcement ──
    // A body that never passed Stripe's signing must be rejected at 400 —
    // this is the live proof that unauthenticated events cannot inject a
    // fake invoice.paid / grant. A replayed body with a FORGED signature
    // is equally refused; real same-id replay dedup is pinned by unit tests
    // (see file header — signing secret / dashboard resend are out of
    // harness scope by design).
    const forged = await fetch(`${BASE}/api/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=forged" },
      body: JSON.stringify({ id: "evt_forged", type: "invoice.paid", data: { object: {} } }),
    });
    step("webhook_signature_enforced", forged.status === 400, `forged invoice.paid → HTTP ${forged.status}`);

    // Any miss above is a failure verdict; verdict-exit maps steps → code.
    const failed = Object.entries(verdict.steps).filter(([, s]) => !s.ok).map(([n]) => n);
    verdict.verdict = failed.length === 0 ? "PASS" : `FAIL: ${failed.join(", ")}`;
  } catch (err) {
    verdict.verdict = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
    await shot(page, "failure-state");
  } finally {
    verdict.finishedAt = new Date().toISOString();
    writeFileSync(path.join(ARTIFACT_DIR, "verdict.json"), JSON.stringify(verdict, null, 2));
    console.log(`=== VERDICT: ${verdict.verdict} ===`);
    console.log(`Artifacts: ${ARTIFACT_DIR}`);
    await browser.close();
  }

  process.exit(verdict.verdict === "PASS" ? 0 : 1);
}

async function apiPost(page, apiPath, body) {
  return page.evaluate(async ({ p, b }) => {
    const r = await fetch(p, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  }, { p: apiPath, b: body });
}

main().catch((err) => {
  console.error(`=== VERDICT: FAIL: ${err instanceof Error ? err.message : String(err)} ===`);
  writeFileSync(path.join(ARTIFACT_DIR, "verdict.json"), JSON.stringify({ ...verdict, verdict: `FAIL: ${String(err)}` }, null, 2));
  process.exit(1);
});
