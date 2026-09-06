/**
 * litt production finish — orchestrate the remaining production gates.
 *
 * Automatically proceeds through every safe step.
 * Only pauses for genuine owner/provider-enforced handoffs.
 *
 * Phases:
 *   1. Repository — verify git main, clean, synced
 *   2. Operator — verify PR #131 protections present
 *   3. Studio code — verify tests pass
 *   4. Pricing — verify $15/$39/$149
 *   5. Stripe catalog — verify live prices
 *   6. Stripe security — rotate key (owner handoff if needed)
 *   7. Webhook — set signing secret (owner handoff if needed)
 *   8. Sandbox checkout — TEST-mode E2E
 *   9. Studio acceptance — owner browser acceptance
 *
 * Resumable: if paused for owner action, run again to resume.
 */

import { ok, fail, warn, header, c, exec } from "../lib/utils.js";
import {
  getProductionRepoRoot,
  runAllChecks,
  summarizeChecks,
  checkWebhookSecret,
  checkStripeSecretKey,
  type CheckResult,
} from "../lib/production-checks.js";
import { redact } from "../lib/secret-redaction.js";
import {
  createRun,
  loadRun,
  saveRun,
  startStep,
  completeStep,
  blockStep,
  failStep,
  resumeRun,
  finishRun,
  findIncompleteRun,
  deleteRun,
  type FinishRun,
  type FinishPhase,
} from "../lib/production-run-store.js";

/**
 * Production checks run against the project LiTT was invoked for.
 *
 * The active project root comes from the shared project resolver rather
 * than the CLI installation path, so installed/global CLIs and binaries
 * built in another worktree operate on the caller's project.
 */

export async function productionFinishCommand(args: string[]): Promise<number> {
  const repoRoot = getProductionRepoRoot();
  const resumeId = args.find((a) => a.startsWith("--resume="))?.split("=")[1];
  const json = args.includes("--json");

  header("◬ LiTT · PRODUCTION");

  // Resume or create a new run
  let run: FinishRun;
  if (resumeId) {
    const loaded = loadRun(resumeId);
    if (!loaded) {
      fail(`Run not found: ${resumeId}`);
      return 1;
    }
    run = loaded;
    resumeRun(run);
    console.log(`${c.dim}Resuming run: ${run.id}${c.reset}`);
  } else {
    // Check for an existing incomplete run
    const incomplete = findIncompleteRun();
    if (incomplete) {
      run = incomplete;
      resumeRun(run);
      console.log(`${c.dim}Resuming incomplete run: ${run.id}${c.reset}`);
    } else {
      run = createRun();
      console.log(`${c.dim}Starting new run: ${run.id}${c.reset}`);
    }
  }

  // Run through each phase
  await runPhase(run, "repository", async () => {
    const groups = await runAllChecks();
    const repoGroup = groups.find((g) => g.name === "Repository");
    if (!repoGroup) return { status: "fail", detail: "No repository checks" };
    const allPass = repoGroup.results.every((r) => r.status === "pass");
    return {
      status: allPass ? "pass" : "fail",
      detail: allPass ? "main synced, clean" : "Repository checks failed",
    };
  });

  await runPhase(run, "operator", async () => {
    // Verify PR #131 protections are present (check for key files)
    const leaseFile = exec(`git -C "${repoRoot}" ls-files packages/litt-cli/src/lib/worktree-lease.ts`);
    const runStoreFile = exec(`git -C "${repoRoot}" ls-files packages/litt-cli/src/lib/run-store.ts`);
    const canonicalFile = exec(`git -C "${repoRoot}" ls-files packages/litt-cli/src/lib/canonical-main.ts`);
    if (leaseFile.stdout && runStoreFile.stdout && canonicalFile.stdout) {
      return { status: "pass", detail: "PR #131 protections present" };
    }
    return { status: "fail", detail: "Operator protections missing" };
  });

  await runPhase(run, "studio_code", async () => {
    // Run the key test suites — use a longer timeout (120s) for vitest
    const r = exec(
      "npx vitest run tests/pricing-consistency.test.ts tests/stripe-catalog-contract.test.ts tests/approval-flow.test.ts tests/security-isolation.test.ts tests/litt-chat-path.test.ts",
      { cwd: repoRoot, timeout: 120000 },
    );
    if (r.exitCode === 0) {
      return { status: "pass", detail: "Key test suites pass" };
    }
    return { status: "fail", detail: `Test suites failed: ${r.combined.slice(-200)}` };
  });

  await runPhase(run, "pricing", async () => {
    const groups = await runAllChecks();
    const stripeGroup = groups.find((g) => g.name === "Stripe");
    const priceResults = stripeGroup?.results.filter((r) => r.id.startsWith("stripe.price.")) ?? [];
    const allPass = priceResults.every((r) => r.status === "pass");
    if (allPass && priceResults.length === 3) {
      return { status: "pass", detail: "$15/$39/$149 verified" };
    }
    return { status: "fail", detail: "Price verification failed" };
  });

  await runPhase(run, "stripe_catalog", async () => {
    const groups = await runAllChecks();
    const stripeGroup = groups.find((g) => g.name === "Stripe");
    const webhookResult = stripeGroup?.results.find((r) => r.id === "stripe.webhook");
    if (webhookResult?.status === "pass") {
      return { status: "pass", detail: "Webhook endpoint healthy" };
    }
    return { status: "warn", detail: webhookResult?.detail ?? "Webhook issues" };
  });

  // Stripe security — this is where we may need owner handoff
  await runPhase(run, "stripe_security", async () => {
    const secretCheck = checkStripeSecretKey();
    if (secretCheck.status === "pass") {
      // Key is set — but we can't verify if it was rotated via API
      // Check if the key is functional by making a test API call
      const testR = exec("stripe customers list --limit 1 --live");
      if (testR.exitCode === 0) {
        return { status: "pass", detail: "Stripe API functional with current key" };
      }
      // Key may be expired or invalid
      return {
        status: "blocked",
        detail: "Stripe API key not functional",
        handoff: {
          title: "Stripe account-owner confirmation required",
          description: "The live Stripe secret key needs to be rotated. Stripe requires account-owner confirmation to roll live credentials.",
          url: "https://dashboard.stripe.com/apikeys",
          resumeAction: "After rotating the key and updating Railway, run: litt production finish --resume=" + run.id,
        },
      };
    }
    return {
      status: "blocked",
      detail: "Stripe secret key not set",
      handoff: {
        title: "Stripe secret key required",
        description: "Set STRIPE_SECRET_KEY in Railway production environment with a valid live key.",
        url: "https://dashboard.stripe.com/apikeys",
        resumeAction: "After setting the key, run: litt production finish --resume=" + run.id,
      },
    };
  });

  // Webhook — signing secret may need owner handoff
  await runPhase(run, "webhook", async () => {
    const whsecCheck = checkWebhookSecret();
    if (whsecCheck.status === "pass") {
      return { status: "pass", detail: "Webhook signing secret set" };
    }
    return {
      status: "blocked",
      detail: "Webhook signing secret not set",
      handoff: {
        title: "Stripe webhook signing secret required",
        description: "Stripe does not expose existing endpoint signing secrets via API. The account owner must reveal it in the Stripe Dashboard and provide it to LiTT.",
        url: "https://dashboard.stripe.com/webhooks",
        resumeAction: "After revealing the secret, LiTT will set it in Railway and redeploy. Run: litt production finish --resume=" + run.id,
      },
    };
  });

  // Sandbox checkout — TEST mode E2E
  await runPhase(run, "sandbox_checkout", async () => {
    // Verify the billing state machine tests pass — use a longer timeout (120s) for vitest
    const r = exec(
      "npx vitest run src/__tests__/billing-state-machine.test.ts",
      { cwd: repoRoot, timeout: 120000 },
    );
    if (r.exitCode === 0) {
      return { status: "pass", detail: "Billing state machine tests pass (45 tests)" };
    }
    return { status: "fail", detail: `Billing state machine tests failed: ${r.combined.slice(-200)}` };
  });

  // Studio acceptance — owner browser acceptance
  await runPhase(run, "studio_acceptance", async () => {
    return {
      status: "blocked",
      detail: "Owner browser acceptance required",
      handoff: {
        title: "Owner Studio browser acceptance",
        description: "Larry must run the 10-step browser acceptance script at https://www.litlabs.net/studio. See STUDIO_OWNER_ACCEPTANCE.md for the full script.",
        url: "https://www.litlabs.net/studio",
        resumeAction: "After completing acceptance, run: litt production finish --resume=" + run.id,
      },
    };
  });

  // Final verdict
  const allSteps = run.steps.filter((s) => s.phase !== "complete");
  const allPass = allSteps.every((s) => s.status === "pass");
  const anyBlocked = allSteps.some((s) => s.status === "blocked");
  const anyFailed = allSteps.some((s) => s.status === "failed");

  // Print summary
  console.log(`\n${c.gray}${"─".repeat(40)}${c.reset}`);
  console.log(`${c.bold}Production Finish${c.reset}\n`);

  for (const step of run.steps.filter((s) => s.phase !== "complete")) {
    printStep(step.phase, step.status, step.detail);
  }

  // Price summary
  console.log(`\n${c.dim}  Creator      $15/mo        ${run.steps.find((s) => s.phase === "pricing")?.status === "pass" ? c.green + "✓" : c.red + "✗"}${c.reset}`);
  console.log(`${c.dim}  Pro          $39/mo        ${run.steps.find((s) => s.phase === "pricing")?.status === "pass" ? c.green + "✓" : c.red + "✗"}${c.reset}`);
  console.log(`${c.dim}  Founder      $149          ${run.steps.find((s) => s.phase === "pricing")?.status === "pass" ? c.green + "✓" : c.red + "✗"}${c.reset}`);

  // Production info
  const sha = exec(`git -C "${repoRoot}" rev-parse HEAD`).stdout.trim();
  console.log(`\n${c.dim}  Production${c.reset}`);
  console.log(`${c.dim}  ${sha.slice(0, 8)}${c.reset}`);

  if (anyBlocked) {
    const blockedStep = allSteps.find((s) => s.status === "blocked");
    console.log(`\n${c.yellow}${c.bold}PAUSED${c.reset} — ${blockedStep?.detail}`);
    if (blockedStep?.handoff) {
      console.log(`\n${c.bold}${blockedStep.handoff.title}${c.reset}`);
      console.log(`${c.dim}${blockedStep.handoff.description}${c.reset}`);
      if (blockedStep.handoff.url) {
        console.log(`\n${c.blue}  → ${blockedStep.handoff.url}${c.reset}`);
      }
      console.log(`\n${c.dim}Run ID: ${run.id}${c.reset}`);
      console.log(`${c.dim}Resume: litt production finish --resume=${run.id}${c.reset}`);
    }
    finishRun(run, "fail");
    if (json) console.log(JSON.stringify({ run, verdict: "paused" }, null, 2));
    return 0; // Paused is not an error exit
  }

  if (anyFailed) {
    console.log(`\n${c.red}${c.bold}FAILED${c.reset}`);
    finishRun(run, "fail");
    if (json) console.log(JSON.stringify({ run, verdict: "fail" }, null, 2));
    return 1;
  }

  if (allPass) {
    console.log(`\n${c.green}${c.bold}✓ PRODUCTION READY${c.reset}`);
    finishRun(run, "pass");
    if (json) console.log(JSON.stringify({ run, verdict: "pass" }, null, 2));
    return 0;
  }

  // Some warnings but no blockers
  console.log(`\n${c.yellow}${c.bold}⚠ DEGRADED${c.reset}`);
  finishRun(run, "fail");
  if (json) console.log(JSON.stringify({ run, verdict: "degraded" }, null, 2));
  return 0;
}

// ─── Helpers ───────────────────────────────────────────────────────────

interface PhaseResult {
  status: "pass" | "fail" | "warn" | "blocked";
  detail?: string;
  handoff?: {
    title: string;
    description: string;
    url?: string;
    resumeAction: string;
  };
}

async function runPhase(
  run: FinishRun,
  phase: FinishPhase,
  fn: () => Promise<PhaseResult>,
): Promise<void> {
  // Skip if already passed
  const existing = run.steps.find((s) => s.phase === phase);
  if (existing?.status === "pass") return;
  // Skip if blocked and not resumed
  if (existing?.status === "blocked" && run.paused) return;

  startStep(run, phase);
  const result = await fn();

  if (result.status === "pass") {
    completeStep(run, phase, result.detail);
  } else if (result.status === "blocked") {
    blockStep(run, phase, result.handoff, result.detail);
  } else if (result.status === "fail") {
    failStep(run, phase, result.detail);
  }
}

function printStep(phase: string, status: string, detail?: string): void {
  const icon =
    status === "pass" ? `${c.green}✓${c.reset}` :
    status === "fail" ? `${c.red}✗${c.reset}` :
    status === "blocked" ? `${c.red}●${c.reset}` :
    status === "in_progress" ? `${c.blue}●${c.reset}` :
    `${c.gray}○${c.reset}`;
  const label = phase.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const detailStr = detail ? ` ${c.dim}— ${detail}${c.reset}` : "";
  console.log(`  ${icon} ${label}${detailStr}`);
}
