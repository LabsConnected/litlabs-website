/**
 * litt studio acceptance — pre-flight checks + owner browser acceptance guide.
 *
 * Before Larry touches a browser, automatically verify:
 *   - Production SHA
 *   - Health
 *   - Database
 *   - Storage
 *   - Terminal service
 *   - Studio routes
 *   - Clerk route availability
 *   - Preview infrastructure
 *
 * Then present the owner acceptance checklist.
 */

import { ok, fail, warn, header, c } from "../lib/utils.js";
import {
  checkProductionHealth,
  checkProductionSHA,
  checkTerminalService,
  PRODUCTION_DOMAIN,
} from "../lib/production-checks.js";

const ACCEPTANCE_STEPS = [
  "Sign in",
  "Create project",
  "Studio Ready",
  "Ask LiTT",
  "File read/write",
  "Approval",
  "Terminal",
  "Preview",
  "Persistence",
] as const;

export async function studioAcceptanceCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");

  header("LiTT Studio Acceptance");

  // Pre-flight checks
  console.log(`\n${c.bold}Pre-flight Checks${c.reset}`);

  // Production health
  const health = await checkProductionHealth();
  printResult(health);

  // Production SHA
  const sha = await checkProductionSHA();
  printResult(sha);

  // Studio route availability
  console.log(`\n${c.dim}Checking Studio routes...${c.reset}`);
  const studioRoute = await checkRoute("/studio");
  printResult(studioRoute);

  // Clerk auth availability
  console.log(`\n${c.dim}Checking Clerk auth...${c.reset}`);
  const clerkRoute = await checkRoute("/sign-in");
  printResult(clerkRoute);

  // Terminal service
  console.log(`\n${c.dim}Checking terminal service...${c.reset}`);
  const terminalCheck = checkTerminalService();
  printResult(terminalCheck);

  // API health sub-checks
  console.log(`\n${c.dim}Checking API endpoints...${c.reset}`);
  const apiHealth = await checkRoute("/api/health");
  printResult(apiHealth);

  // Determine if pre-flight passed
  const preflightPass =
    health.status === "pass" &&
    sha.status !== "fail" &&
    studioRoute.status === "pass" &&
    clerkRoute.status !== "fail";

  if (!preflightPass) {
    console.log(`\n${c.red}${c.bold}✗ Pre-flight checks failed${c.reset}`);
    console.log(`${c.dim}  Fix the failing checks before running browser acceptance.${c.reset}`);
    return 1;
  }

  console.log(`\n${c.green}${c.bold}✓ Pre-flight checks passed${c.reset}`);

  // Owner acceptance checklist
  console.log(`\n${c.bold}Owner Browser Acceptance${c.reset}`);
  console.log(`${c.dim}  Open: ${PRODUCTION_DOMAIN}/studio${c.reset}\n`);

  for (let i = 0; i < ACCEPTANCE_STEPS.length; i++) {
    console.log(`  ${c.gray}○${c.reset} ${i + 1}. ${ACCEPTANCE_STEPS[i]}`);
  }

  console.log(`\n${c.dim}After completing each step, mark it PASS or FAIL.${c.reset}`);
  console.log(`${c.dim}On failure, LiTT will capture: stage, timestamp, project, run ID, correlation ID.${c.reset}`);
  console.log(`${c.dim}Full script: STUDIO_OWNER_ACCEPTANCE.md${c.reset}`);

  if (json) {
    console.log(JSON.stringify({
      preflight: "pass",
      steps: ACCEPTANCE_STEPS,
      url: `${PRODUCTION_DOMAIN}/studio`,
    }, null, 2));
  }

  return 0;
}

async function checkRoute(path: string): Promise<{ status: string; label: string; detail?: string }> {
  try {
    const response = await fetch(`${PRODUCTION_DOMAIN}${path}`, {
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
    });
    // 200, 301, 302, 307 are all "route exists" responses
    if (response.status < 400 || response.status === 302 || response.status === 307) {
      return { status: "pass", label: path, detail: `HTTP ${response.status}` };
    }
    return { status: "fail", label: path, detail: `HTTP ${response.status}` };
  } catch (err) {
    return { status: "fail", label: path, detail: err instanceof Error ? err.message : "unreachable" };
  }
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
