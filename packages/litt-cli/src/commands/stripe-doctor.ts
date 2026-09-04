/**
 * litt stripe doctor — Stripe-specific diagnostics.
 *
 * Checks: auth, secret key, publishable key, webhook secret,
 * webhook endpoint, webhook events, live prices, legacy catalog.
 *
 * Never prints secret values.
 */

import { ok, fail, warn, header, c } from "../lib/utils.js";
import {
  checkStripeAuth,
  checkStripeSecretKey,
  checkStripePublishableKey,
  checkWebhookSecret,
  checkWebhookEndpoint,
  checkStripePrices,
  type CheckResult,
} from "../lib/production-checks.js";

export async function stripeDoctorCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");

  header("LiTT Stripe Doctor");

  const results: CheckResult[] = [
    checkStripeAuth(),
    checkStripeSecretKey(),
    checkStripePublishableKey(),
    checkWebhookSecret(),
    checkWebhookEndpoint(),
    ...checkStripePrices(),
  ];

  if (json) {
    console.log(JSON.stringify({ results }, null, 2));
    return results.every((r) => r.status === "pass") ? 0 : 1;
  }

  for (const result of results) {
    printResult(result);
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warnings = results.filter((r) => r.status === "warn").length;

  console.log(`\n${c.gray}${"─".repeat(40)}${c.reset}`);
  if (failed > 0) {
    console.log(`${c.bold}${c.red}Stripe: NOT READY${c.reset}`);
    console.log(`${c.dim}  ${passed} passed · ${failed} failed · ${warnings} warnings${c.reset}`);
    const firstFail = results.find((r) => r.status === "fail");
    if (firstFail?.fix) {
      console.log(`\n${c.yellow}NEXT:${c.reset} ${firstFail.fix}`);
    }
  } else if (warnings > 0) {
    console.log(`${c.bold}${c.yellow}Stripe: DEGRADED${c.reset}`);
  } else {
    console.log(`${c.bold}${c.green}Stripe: READY${c.reset}`);
  }

  return failed > 0 ? 1 : 0;
}

function printResult(result: CheckResult): void {
  const icon =
    result.status === "pass" ? `${c.green}✓${c.reset}` :
    result.status === "fail" ? `${c.red}✗${c.reset}` :
    result.status === "warn" ? `${c.yellow}!${c.reset}` :
    `${c.gray}○${c.reset}`;
  const detail = result.detail ? ` ${c.dim}— ${result.detail}${c.reset}` : "";
  console.log(`  ${icon} ${result.label}${detail}`);
  if (result.fix && result.status !== "pass") {
    console.log(`    ${c.dim}Fix: ${result.fix}${c.reset}`);
  }
}
