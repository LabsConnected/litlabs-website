/**
 * litt deploy verify — watch a Railway deployment and verify production health.
 *
 * Steps:
 *   1. Detect the latest Railway deployment
 *   2. If needed, trigger a redeploy from source
 *   3. Watch build state (BUILDING → DEPLOYING → HEALTHCHECK)
 *   4. Wait for healthcheck to pass
 *   5. Call /api/health
 *   6. Compare deployed SHA with expected (local main HEAD)
 *   7. Return PASS/FAIL
 */

import { ok, fail, warn, header, c, exec } from "../lib/utils.js";
import {
  checkProductionHealth,
  checkProductionSHA,
  RAILWAY_SERVICE_NAME,
  PRODUCTION_DOMAIN,
} from "../lib/production-checks.js";
import { redact } from "../lib/secret-redaction.js";

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 36; // 6 minutes max

export async function deployVerifyCommand(args: string[]): Promise<number> {
  const triggerRedeploy = args.includes("--redeploy");
  const json = args.includes("--json");

  header("LiTT Deployment Verification");

  // Get expected SHA from local main
  const expectedSHA = exec("git -C E:\\LiTT\\Worktrees\\main rev-parse HEAD").stdout.trim();
  console.log(`${c.dim}Expected SHA: ${expectedSHA.slice(0, 8)}${c.reset}`);

  // Trigger redeploy if requested
  if (triggerRedeploy) {
    console.log(`\n${c.dim}Triggering redeploy from source...${c.reset}`);
    const r = exec(`railway deployment redeploy --service "${RAILWAY_SERVICE_NAME}" --environment production --from-source --yes 2>&1`);
    if (r.exitCode !== 0) {
      fail(`Failed to trigger redeploy: ${redact(r.stderr)}`);
      return 1;
    }
    ok("Redeploy triggered");
  }

  // Watch deployment
  console.log(`\n${c.dim}Watching deployment...${c.reset}`);

  let lastStatus = "";
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const r = exec(`railway deployment list --service "${RAILWAY_SERVICE_NAME}" --environment production 2>&1`);
    if (r.exitCode !== 0) {
      warn("Cannot fetch deployment list, retrying...");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Parse the first (most recent) deployment
    const lines = r.stdout.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Find the status of the most recent deployment
    const firstDeployLine = lines.find((l) => l.includes("|"));
    if (!firstDeployLine) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const status = extractDeployStatus(firstDeployLine);
    if (status && status !== lastStatus) {
      lastStatus = status;
      printDeployProgress(status);
    }

    if (status === "SUCCESS" || status === "HEALTHCHECK SUCCEEDED") {
      ok("Deployment succeeded");
      break;
    }

    if (status === "FAILED" || status === "CRASHED") {
      fail(`Deployment ${status.toLowerCase()}`);
      return 1;
    }

    if (status === "SKIPPED") {
      // The latest deploy was skipped — check if production is already healthy
      console.log(`${c.dim}Latest deploy skipped, checking production health...${c.reset}`);
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Wait a moment for the health endpoint to be ready
  console.log(`\n${c.dim}Verifying production health...${c.reset}`);
  await sleep(3000);

  // Check health
  const health = await checkProductionHealth();
  printResult(health);

  if (health.status === "fail") {
    fail("Production health check failed");
    return 1;
  }

  // Check SHA
  const sha = await checkProductionSHA(expectedSHA);
  printResult(sha);

  if (json) {
    console.log(JSON.stringify({ health, sha, expectedSHA: expectedSHA.slice(0, 8) }, null, 2));
  }

  if (sha.status === "pass") {
    console.log(`\n${c.green}${c.bold}✓ Deployment verified${c.reset}`);
    console.log(`${c.dim}  Production: ${expectedSHA.slice(0, 8)}${c.reset}`);
    console.log(`${c.dim}  Health: ${health.detail ?? "ok"}${c.reset}`);
    return 0;
  }

  if (sha.status === "warn") {
    warn(`Production SHA mismatch: ${sha.detail}`);
    warn("Production may be running a different commit. Run: litt deploy verify --redeploy");
    return 0;
  }

  fail("SHA verification failed");
  return 1;
}

function printDeployProgress(status: string): void {
  const icon =
    status === "SUCCESS" || status === "HEALTHCHECK SUCCEEDED" ? `${c.green}✓${c.reset}` :
    status === "FAILED" || status === "CRASHED" ? `${c.red}✗${c.reset}` :
    `${c.blue}●${c.reset}`;
  console.log(`  ${icon} ${status}`);
}

function printResult(result: { status: string; label: string; detail?: string }): void {
  const icon =
    result.status === "pass" ? `${c.green}✓${c.reset}` :
    result.status === "fail" ? `${c.red}✗${c.reset}` :
    result.status === "warn" ? `${c.yellow}!${c.reset}` :
    `${c.gray}○${c.reset}`;
  const detail = result.detail ? ` ${c.dim}— ${result.detail}${c.reset}` : "";
  console.log(`  ${icon} ${result.label}${detail}`);
}

function extractDeployStatus(line: string): string | null {
  // Railway CLI output format: "ID | STATUS | TIMESTAMP | SHA"
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length >= 2) {
    return parts[1].toUpperCase();
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
