/**
 * litt explain — Pipe errors/diffs and get actionable advice.
 * Reads from stdin and analyzes the content.
 *
 * Usage:
 *   echo "TypeError: Cannot read property 'x' of undefined" | litt explain
 *   git diff | litt explain
 *   pnpm build 2>&1 | litt explain
 */

import { ok, fail, warn, header, label, value, c, readStdin, detectProject } from "../lib/utils.js";

export async function explainCommand(args: string[]): Promise<number> {
  // Get input from stdin or args
  let input = readStdin();
  if (!input && args.length > 0) {
    input = args.join(" ");
  }

  if (!input) {
    fail("No input provided. Pipe text to litt explain or pass it as an argument.");
    console.log();
    console.log(`${c.dim}Examples:${c.reset}`);
    console.log(`  echo "TypeError: ..." | litt explain`);
    console.log(`  git diff | litt explain`);
    console.log(`  pnpm build 2>&1 | litt explain`);
    console.log(`  litt explain "Cannot find module '@/lib/utils'"`);
    return 1;
  }

  const project = detectProject();
  header("LiTT Explain");

  console.log(`${label("Project:")} ${value(String(project.packageJson?.name ?? "unknown"), c.bold)}`);
  console.log(`${label("Input:")} ${value(`${input.length} chars`, c.dim)}`);
  console.log();

  const lower = input.toLowerCase();
  const findings: Array<{ type: "error" | "warning" | "info"; message: string; fix?: string }> = [];

  // TypeScript errors
  if (lower.includes("error ts") || lower.includes("type error") || lower.includes("typeerror")) {
    findings.push({
      type: "error",
      message: "TypeScript type error detected",
      fix: "Run `npx tsc --noEmit` to see all type errors. Fix the type mismatch in the referenced file.",
    });
  }

  // Module not found
  if (lower.includes("cannot find module") || lower.includes("module not found")) {
    const match = input.match(/(?:cannot find module|module not found)['"]?\s*['"]?([^'"\s]+)/i);
    const mod = match?.[1] ?? "the module";
    findings.push({
      type: "error",
      message: `Module not found: ${mod}`,
      fix: mod.startsWith("@/")
        ? `Check that the file exists at the expected path. Verify your tsconfig.json paths configuration. Run \`${project.packageManager} install\` if it's a package.`
        : `Run \`${project.packageManager} install ${mod}\` to install the missing package.`,
    });
  }

  // ESLint errors
  if (lower.includes("eslint") && (lower.includes("error") || lower.includes("problem"))) {
    findings.push({
      type: "warning",
      message: "ESLint errors detected",
      fix: `Run \`${project.packageManager} run lint\` to see all errors. Use \`--fix\` to auto-fix formatting issues.`,
    });
  }

  // Build errors
  if (lower.includes("build error") || lower.includes("failed to compile") || lower.includes("build failed")) {
    findings.push({
      type: "error",
      message: "Build compilation error",
      fix: "Check the build output for import errors, missing dependencies, or syntax errors. Run `pnpm build` locally to reproduce.",
    });
  }

  // Test failures
  if (lower.includes("test failed") || lower.includes("tests? failed") || lower.includes("vitest")) {
    findings.push({
      type: "error",
      message: "Test failure detected",
      fix: `Run \`${project.packageManager} test -- --run\` to see failing tests. Review the assertions and implementation.`,
    });
  }

  // Import errors
  if (lower.includes("syntaxerror") || lower.includes("unexpected token") || lower.includes("unexpected identifier")) {
    findings.push({
      type: "error",
      message: "Syntax error detected",
      fix: "Check for missing brackets, parentheses, or commas in the referenced file. The error usually points to the exact line.",
    });
  }

  // Dependency issues
  if (lower.includes("peer dependency") || lower.includes("unmet dependency")) {
    findings.push({
      type: "warning",
      message: "Dependency conflict",
      fix: `Run \`${project.packageManager} install\` to resolve. You may need to update the conflicting package.`,
    });
  }

  // Git conflicts
  if (lower.includes("merge conflict") || lower.includes("conflict in")) {
    findings.push({
      type: "error",
      message: "Git merge conflict",
      fix: "Open the conflicted files, resolve the conflicts (look for <<<<<<< markers), then `git add` and `git commit`.",
    });
  }

  // Environment / auth
  if (lower.includes("env") && (lower.includes("not set") || lower.includes("missing") || lower.includes("undefined"))) {
    findings.push({
      type: "warning",
      message: "Environment variable issue",
      fix: "Check your .env.local file. Copy .env.example and fill in the required values.",
    });
  }

  // Network / API
  if (lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("network error")) {
    findings.push({
      type: "warning",
      message: "Network connectivity issue",
      fix: "Check your internet connection. If connecting to a local service, verify it's running.",
    });
  }

  // Permission errors
  if (lower.includes("eperm") || lower.includes("permission denied") || lower.includes("eacces")) {
    findings.push({
      type: "warning",
      message: "Permission error",
      fix: process.platform === "win32"
        ? "Run your terminal as Administrator, or check file permissions in the project directory."
        : "Check file permissions with `ls -la` and use `chmod` if needed.",
    });
  }

  // Output findings
  if (findings.length === 0) {
    warn("No known error patterns detected in the input.");
    console.log();
    console.log(`${c.dim}Input preview:${c.reset}`);
    console.log(`  ${c.gray}${input.slice(0, 200)}${input.length > 200 ? "..." : ""}${c.reset}`);
  } else {
    for (const finding of findings) {
      const icon = finding.type === "error" ? `${c.red}✗${c.reset}` : finding.type === "warning" ? `${c.yellow}!${c.reset}` : `${c.blue}ℹ${c.reset}`;
      console.log(`  ${icon} ${finding.message}`);
      if (finding.fix) {
        console.log(`    ${c.green}Fix:${c.reset} ${finding.fix}`);
      }
    }
  }

  // Show relevant context
  if (project.hasGit) {
    console.log();
    header("Context");
    console.log(`${label("Branch:")} ${value(project.gitBranch ?? "unknown")}`);
    const changes = project.gitStatus ? project.gitStatus.split("\n").filter(Boolean) : [];
    if (changes.length > 0) {
      console.log(`${label("Changes:")} ${value(`${changes.length} files`, c.yellow)}`);
      for (const change of changes.slice(0, 5)) {
        console.log(`  ${c.gray}${change}${c.reset}`);
      }
    }
  }

  return findings.some((f) => f.type === "error") ? 1 : 0;
}
