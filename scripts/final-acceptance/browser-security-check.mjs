/**
 * Studio browser security acceptance — runs against the deployed app
 * (staging or production) with a real authenticated Clerk session.
 *
 * Drives the SAME proxy route the Studio panel iframe uses, through
 * the browser context's cookie jar, and asserts the security contract
 * end-to-end:
 *
 *   - unauthenticated requests are refused (401)
 *   - legitimate destinations proxy through (google.com, github.com)
 *   - private/loopback/link-local/metadata literals are refused
 *   - DNS names resolving to non-public space are refused
 *   - phishing lookalikes and deceptive subdomains are refused
 *   - every refusal renders the friendly Studio error page, never
 *     raw JSON or an unstyled body
 *
 * Auth: Clerk Backend API sign_in_tokens → __clerk_ticket redeemed on
 * BASE's own /sign-in page (same pattern as prod-mobile-golden.mjs).
 *
 * Env:
 *   LITT_PROD_BASE_URL   target origin (staging URL in CI)
 *   CLERK_SECRET_KEY     Clerk secret for the matching instance
 *   LITT_ACCEPTANCE_USER_ID  disposable acceptance user id (required in CI)
 *
 * Exit 0 = all checks passed; exit 1 = at least one failed.
 */
import { chromium, request as pwRequest } from "@playwright/test";
import { resolveAcceptanceUserId } from "./acceptance-user.mjs";

const BASE = (process.env.LITT_PROD_BASE_URL || "https://www.litlabs.net").replace(/\/$/, "");
const isCI = process.env.GITHUB_ACTIONS === "true";
const USER_ID = resolveAcceptanceUserId({
  isCI,
  envUserId: process.env.LITT_ACCEPTANCE_USER_ID,
});

const PROXY = "/api/studio/browser/proxy";
const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
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

const proxyUrl = (target) => `${BASE}${PROXY}?url=${encodeURIComponent(target)}`;

// Our error documents always carry the Studio title and a friendly
// heading; upstream content never does. Raw JSON errors are a failure.
const ERROR_PAGE_MARKERS = ["LiTT Studio", "can't be shown", "Blocked by the Studio browser"];
const RAW_JSON = /^\s*[{[]/;

async function checkProxy(request, name, target, expect) {
  const resp = await request.get(proxyUrl(target), { timeout: 60_000 });
  const body = await resp.text();
  const ct = resp.headers()["content-type"] ?? "";
  const isErrorPage = ERROR_PAGE_MARKERS.some((m) => body.includes(m)) && ct.includes("text/html");
  const isRawJson = RAW_JSON.test(body) && ct.includes("json");

  if (expect === "allow") {
    const pass = resp.status() < 400 && ct.includes("text/html") && !isErrorPage && !isRawJson;
    record(name, pass, `status=${resp.status()} ct=${ct.slice(0, 40)}`);
    return;
  }
  // expect === "block": must be refused by OUR policy with a friendly page
  const pass = isErrorPage && !isRawJson;
  record(name, pass, `status=${resp.status()} errorPage=${isErrorPage} rawJson=${isRawJson}`);
}

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required");

  const signInToken = await createSignInToken(secretKey);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    // Authenticate: redeem the ticket on BASE's own /sign-in page so the
    // session cookie lands on the target origin.
    const page = await context.newPage();
    await page.goto(
      `${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(signInToken)}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    const baseOrigin = new URL(BASE).origin;
    await page.waitForURL(
      (url) => new URL(url).origin === baseOrigin && !new URL(url).pathname.startsWith("/sign-in"),
      { timeout: 60_000 },
    );
    await page.close();

    const request = context.request;

    // Unauthenticated probe — a bare API context with no cookies must 401.
    const anon = await pwRequest.newContext({ baseURL: BASE });
    try {
      const r = await anon.get(`${PROXY}?url=${encodeURIComponent("https://example.com/")}`, {
        timeout: 30_000,
      });
      record("unauthenticated request refused", r.status() === 401, `status=${r.status()}`);
    } finally {
      await anon.dispose();
    }

    // Legitimate destinations must proxy.
    await checkProxy(request, "google.com proxies", "https://www.google.com/", "allow");
    await checkProxy(request, "github.com proxies", "https://github.com/", "allow");

    // SSRF: loopback, link-local metadata, private literal, and a
    // hostname that resolves to loopback.
    await checkProxy(request, "localhost refused", "http://localhost:3000/", "block");
    await checkProxy(request, "cloud metadata IP refused", "http://169.254.169.254/latest/meta-data", "block");
    await checkProxy(request, "private IP refused", "http://192.168.1.1/", "block");
    await checkProxy(request, "loopback-resolving hostname refused", "http://localtest.me/", "block");

    // Phishing: leet squat, deceptive subdomain, joined brand+affix.
    await checkProxy(request, "typosquat refused", "https://g00gle.com/", "block");
    await checkProxy(request, "deceptive subdomain refused", "https://google.com.evil.com/", "block");
    await checkProxy(request, "joined brand+affix refused", "https://g00glelogin.com/", "block");

    // Regional trusted domains must NOT false-positive.
    await checkProxy(request, "google.com.au proxies", "https://google.com.au/", "allow");
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} browser-security checks passed`);
  if (failed.length > 0) {
    console.log("FAILED:", failed.map((f) => f.name).join("; "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("browser-security-check fatal:", err);
  process.exit(1);
});
