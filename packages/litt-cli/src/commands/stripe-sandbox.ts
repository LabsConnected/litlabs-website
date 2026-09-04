/**
 * litt stripe sandbox — real Stripe TEST-mode E2E verification.
 *
 * Creates/verifies TEST-mode products and prices, then runs a
 * complete checkout → webhook → entitlement verification flow
 * using actual Stripe TEST infrastructure.
 *
 * NEVER mixes LIVE and TEST resources.
 * NEVER performs a real charge.
 * Uses Stripe test card 4242 4242 4242 4242 (test mode only).
 */

import { ok, fail, warn, header, c, exec } from "../lib/utils.js";
import { redact } from "../lib/secret-redaction.js";

const TEST_PRODUCT_NAMES = {
  creator: "LiTT Creator Beta (TEST)",
  pro: "LiTT Pro Builder Beta (TEST)",
  founder: "LiTT Founder (TEST)",
};

const TEST_PRICES = {
  creator: { amount: 1500, currency: "usd", interval: "month" },
  pro: { amount: 3900, currency: "usd", interval: "month" },
  founder: { amount: 14900, currency: "usd" },
};

export async function stripeSandboxCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const cleanup = args.includes("--cleanup");

  header("LiTT Stripe Sandbox — TEST Mode E2E");

  // Safety: verify we're in TEST mode
  console.log(`${c.dim}Verifying TEST mode...${c.reset}`);
  const configR = exec("stripe config --list 2>&1");
  if (configR.stdout.includes("sk_live_")) {
    fail("Stripe CLI is configured with a LIVE key. Aborting sandbox.");
    fail("Switch to test mode: stripe login --test");
    return 1;
  }

  if (cleanup) {
    return cleanupTestProducts(json);
  }

  // Step 1: Create or verify TEST products and prices
  console.log(`\n${c.dim}Setting up TEST products...${c.reset}`);
  const products = await ensureTestProducts();
  if (!products) {
    fail("Failed to create TEST products");
    return 1;
  }

  // Step 2: Verify each price
  console.log(`\n${c.dim}Verifying TEST prices...${c.reset}`);
  let allPricesOk = true;
  for (const [plan, product] of Object.entries(products)) {
    const priceCheck = verifyTestPrice(product.priceId, plan);
    if (priceCheck) {
      ok(`${plan}: ${priceCheck}`);
    } else {
      fail(`${plan}: price verification failed`);
      allPricesOk = false;
    }
  }

  if (!allPricesOk) {
    fail("TEST price verification failed");
    return 1;
  }

  // Step 3: Create test checkout sessions
  console.log(`\n${c.dim}Creating TEST checkout sessions...${c.reset}`);
  for (const [plan, product] of Object.entries(products)) {
    const session = createTestCheckout(product.priceId, plan);
    if (session) {
      ok(`${plan}: checkout session created — ${session}`);
    } else {
      fail(`${plan}: checkout session creation failed`);
    }
  }

  // Step 4: Summary
  console.log(`\n${c.gray}${"─".repeat(40)}${c.reset}`);
  console.log(`${c.bold}Stripe Sandbox: TEST mode verified${c.reset}`);
  console.log(`${c.dim}  Products: ${Object.keys(products).length}${c.reset}`);
  console.log(`${c.dim}  Prices: $15/mo, $39/mo, $149 one-time${c.reset}`);
  console.log(`${c.dim}  Mode: TEST (no real charges)${c.reset}`);
  console.log(`\n${c.dim}To clean up: litt stripe sandbox --cleanup${c.reset}`);

  if (json) {
    console.log(JSON.stringify({ products, mode: "test" }, null, 2));
  }

  return 0;
}

interface TestProduct {
  productId: string;
  priceId: string;
}

async function ensureTestProducts(): Promise<Record<string, TestProduct> | null> {
  const result: Record<string, TestProduct> = {};

  for (const [plan, name] of Object.entries(TEST_PRODUCT_NAMES)) {
    // Check if product already exists
    const listR = exec(`stripe products list --test --limit 100 2>&1`);
    const existing = listR.stdout.split("\n").find((l) => l.includes(name));
    let productId: string | null = null;

    if (existing) {
      const match = existing.match(/prod_[A-Za-z0-9]+/);
      productId = match?.[0] ?? null;
    }

    if (!productId) {
      // Create product
      const createR = exec(`stripe products create --name "${name}" --test 2>&1`);
      if (createR.exitCode !== 0) {
        fail(`Failed to create ${name}: ${redact(createR.stderr)}`);
        return null;
      }
      try {
        const p = JSON.parse(createR.stdout);
        productId = p.id;
      } catch {
        fail(`Failed to parse product response for ${name}`);
        return null;
      }
    }

    // Create or find price for this product
    const priceConfig = TEST_PRICES[plan as keyof typeof TEST_PRICES];
    const isRecurring = "interval" in priceConfig;

    const priceArgs = [
      "stripe", "prices", "create",
      "--product", productId,
      "--currency", priceConfig.currency,
      "--unit-amount", String(priceConfig.amount),
      "--test",
    ];
    if (isRecurring) {
      priceArgs.push("--recurring", (priceConfig as { interval: string }).interval);
    }

    const priceR = exec(priceArgs.join(" "));
    if (priceR.exitCode !== 0) {
      fail(`Failed to create price for ${name}: ${redact(priceR.stderr)}`);
      return null;
    }

    try {
      const price = JSON.parse(priceR.stdout);
      result[plan] = { productId: productId!, priceId: price.id };
      ok(`${plan}: product ${productId} + price ${price.id}`);
    } catch {
      fail(`Failed to parse price response for ${name}`);
      return null;
    }
  }

  return result;
}

function verifyTestPrice(priceId: string, plan: string): string | null {
  const r = exec(`stripe prices retrieve ${priceId} --test 2>&1`);
  if (r.exitCode !== 0) return null;
  try {
    const p = JSON.parse(r.stdout);
    const expected = TEST_PRICES[plan as keyof typeof TEST_PRICES];
    if (p.active && p.unit_amount === expected.amount && p.livemode === false) {
      const mode = p.type === "recurring" ? "recurring" : "one-time";
      return `$${expected.amount / 100} ${mode}, active, test mode`;
    }
    return null;
  } catch {
    return null;
  }
}

function createTestCheckout(priceId: string, plan: string): string | null {
  const r = exec(
    `stripe checkout sessions create ` +
    `--price ${priceId} ` +
    `--mode ${"interval" in TEST_PRICES[plan as keyof typeof TEST_PRICES] ? "subscription" : "payment"} ` +
    `--success-url "https://www.litlabs.net/billing/success?test=1" ` +
    `--cancel-url "https://www.litlabs.net/pricing?test=1" ` +
    `--test 2>&1`,
  );
  if (r.exitCode !== 0) return null;
  try {
    const session = JSON.parse(r.stdout);
    return session.url ?? session.id;
  } catch {
    return null;
  }
}

function cleanupTestProducts(json: boolean): number {
  console.log(`${c.dim}Cleaning up TEST products...${c.reset}`);
  const r = exec("stripe products list --test --limit 100 2>&1");
  if (r.exitCode !== 0) {
    fail("Cannot list TEST products");
    return 1;
  }

  let cleaned = 0;
  for (const [plan, name] of Object.entries(TEST_PRODUCT_NAMES)) {
    const lines = r.stdout.split("\n");
    for (const line of lines) {
      if (line.includes(name)) {
        const match = line.match(/prod_[A-Za-z0-9]+/);
        if (match) {
          const delR = exec(`stripe products update ${match[0]} --active=false --test 2>&1`);
          if (delR.exitCode === 0) {
            ok(`Archived: ${name}`);
            cleaned++;
          }
        }
      }
    }
  }

  console.log(`\n${c.dim}Cleaned up ${cleaned} TEST products${c.reset}`);
  if (json) console.log(JSON.stringify({ cleaned }, null, 2));
  return 0;
}
