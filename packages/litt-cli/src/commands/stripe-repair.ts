/**
 * litt stripe repair — fix Stripe configuration issues.
 *
 * Can fix:
 *   - Missing webhook events on the live endpoint
 *   - Webhook endpoint disabled
 *
 * Cannot fix (requires owner action):
 *   - Secret key rotation (Stripe Dashboard only)
 *   - Webhook signing secret (Stripe Dashboard only)
 *
 * Never prints secret values.
 */

import { ok, fail, warn, header, c, exec } from "../lib/utils.js";
import {
  checkWebhookEndpoint,
  EXPECTED_WEBHOOK_EVENTS,
  WEBHOOK_URL,
  RAILWAY_SERVICE_NAME,
} from "../lib/production-checks.js";
import { redact } from "../lib/secret-redaction.js";

export async function stripeRepairCommand(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");

  header("LiTT Stripe Repair");

  // Check current webhook endpoint state
  console.log(`\n${c.dim}Checking webhook endpoint...${c.reset}`);
  const webhookCheck = checkWebhookEndpoint();

  if (webhookCheck.status === "pass") {
    ok("Webhook endpoint is healthy — nothing to repair");
    return 0;
  }

  if (webhookCheck.status === "fail" && webhookCheck.detail === "Endpoint not found") {
    // Create the webhook endpoint
    console.log(`${c.dim}Creating webhook endpoint...${c.reset}`);
    if (dryRun) {
      console.log(`${c.yellow}[DRY RUN]${c.reset} Would create: ${WEBHOOK_URL}`);
      return 0;
    }
    const createArgs = [
      "stripe", "webhook_endpoints", "create",
      "--url", WEBHOOK_URL,
      "--live",
    ];
    for (const evt of EXPECTED_WEBHOOK_EVENTS) {
      createArgs.push("--enabled-events", evt);
    }
    const r = exec(createArgs.join(" "));
    if (r.exitCode === 0) {
      ok("Webhook endpoint created");
    } else {
      fail(`Failed to create webhook endpoint: ${redact(r.stderr)}`);
      return 1;
    }
  } else if (webhookCheck.status === "warn") {
    // Update the existing endpoint with missing events
    console.log(`${c.dim}Updating webhook endpoint events...${c.reset}`);
    const endpointId = extractEndpointId();
    if (!endpointId) {
      fail("Cannot determine webhook endpoint ID");
      return 1;
    }
    if (dryRun) {
      console.log(`${c.yellow}[DRY RUN]${c.reset} Would update ${endpointId} with all events`);
      return 0;
    }
    const updateArgs = [
      "stripe", "webhook_endpoints", "update", endpointId,
      "--live",
    ];
    for (const evt of EXPECTED_WEBHOOK_EVENTS) {
      updateArgs.push("--enabled-events", evt);
    }
    const r = exec(updateArgs.join(" "));
    if (r.exitCode === 0) {
      ok("Webhook endpoint updated with all events");
    } else {
      fail(`Failed to update webhook endpoint: ${redact(r.stderr)}`);
      return 1;
    }
  }

  // Re-check
  console.log(`\n${c.dim}Re-checking...${c.reset}`);
  const recheck = checkWebhookEndpoint();
  if (recheck.status === "pass") {
    ok("Webhook endpoint is now healthy");
    return 0;
  }
  fail(`Webhook endpoint still has issues: ${recheck.detail}`);
  return 1;
}

function extractEndpointId(): string | null {
  const r = exec("stripe webhook_endpoints list --live");
  if (r.exitCode !== 0) return null;
  // Look for we_... ID near our URL
  const lines = r.stdout.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(WEBHOOK_URL) && i > 0) {
      // The ID is usually in a preceding line or the same line
      const idMatch = lines[i].match(/we_[A-Za-z0-9]+/);
      if (idMatch) return idMatch[0];
      // Check previous lines
      for (let j = Math.max(0, i - 5); j < i; j++) {
        const m = lines[j].match(/we_[A-Za-z0-9]+/);
        if (m) return m[0];
      }
    }
  }
  // Fallback: find any we_ ID in the output
  const match = r.stdout.match(/we_[A-Za-z0-9]+/);
  return match?.[0] ?? null;
}
