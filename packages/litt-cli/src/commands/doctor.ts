/**
 * litt doctor — Check system health.
 * Verifies Node, Git, pnpm, network, and project setup.
 */

import { exec, hasCommand, ok, fail, warn, header, label, value, detectProject, c } from "../lib/utils.js";

export async function doctorCommand(_args: string[]): Promise<number> {
  header("LiTT Doctor — System Health Check");

  // Node
  const nodeVersion = process.version;
  const nodeOk = nodeVersion.startsWith("v18") || nodeVersion.startsWith("v20") || nodeVersion.startsWith("v22");
  if (nodeOk) ok(`Node.js ${nodeVersion}`);
  else fail(`Node.js ${nodeVersion} (requires >=18)`);

  // Git
  if (hasCommand("git")) {
    const gitVersion = exec("git --version").stdout;
    ok(`Git: ${gitVersion}`);
  } else {
    fail("Git not found");
  }

  // Package managers
  for (const pm of ["pnpm", "npm", "yarn"]) {
    if (hasCommand(pm)) {
      const ver = exec(`${pm} --version`).stdout;
      ok(`${pm}: v${ver}`);
    } else {
      warn(`${pm}: not installed`);
    }
  }

  // Network — check if litlabs.net is reachable
  header("Network");
  try {
    const result = exec(
      process.platform === "win32"
        ? "powershell -Command (Invoke-WebRequest -Uri https://litlabs.net -Method Head -TimeoutSec 5 -UseBasicParsing).StatusCode"
        : "curl -sI https://litlabs.net | head -1",
    );
    if (result.exitCode === 0 && (result.stdout.includes("200") || result.stdout.includes("301") || result.stdout.includes("302"))) {
      ok("litlabs.net reachable");
    } else {
      warn("litlabs.net not reachable (may be offline)");
    }
  } catch {
    warn("Network check failed");
  }

  // Project
  header("Project");
  const project = detectProject();
  if (project.hasPackageJson) {
    ok(`package.json found at ${project.rootDir}`);
    if (project.framework) ok(`Framework: ${project.framework}`);
    if (project.packageManager) ok(`Package manager: ${project.packageManager}`);
    if (project.hasTsConfig) ok("TypeScript configured");
    else warn("No tsconfig.json found");
  } else {
    warn("No package.json found in current directory");
  }

  if (project.hasGit) {
    ok(`Git branch: ${project.gitBranch}`);
    const changedLines = project.gitStatus ? project.gitStatus.split("\n").filter(Boolean) : [];
    if (changedLines.length > 0) {
      warn(`${changedLines.length} uncommitted changes`);
    } else {
      ok("Working tree clean");
    }
  } else {
    warn("Not a git repository");
  }

  // Environment
  header("Environment");
  const envVars = [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
  ];
  for (const envVar of envVars) {
    if (process.env[envVar]) ok(`${envVar}: set`);
    else warn(`${envVar}: not set`);
  }

  // Summary
  header("Summary");
  console.log(`${label("Platform:")} ${value(process.platform)} ${value(process.arch, c.dim)}`);
  console.log(`${label("Shell:")} ${value(process.env.SHELL ?? process.env.ComSpec ?? "unknown")}`);
  console.log(`${label("CLI Version:")} ${value("0.1.0", c.green)}`);

  return 0;
}
