/**
 * litt ask — Ask LiTT a question about your project.
 * Analyzes the project and provides context-aware answers.
 * (Local heuristic mode — no API key required.)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { ok, fail, warn, header, label, value, detectProject, c } from "../lib/utils.js";

export async function askCommand(args: string[]): Promise<number> {
  const question = args.join(" ").trim();

  if (!question) {
    fail("Please provide a question. Example: litt ask \"How do I fix the build?\"");
    return 1;
  }

  const project = detectProject();

  header("LiTT Analysis");

  if (!project.hasPackageJson) {
    fail("No package.json found. Run this command from your project root.");
    return 1;
  }

  console.log(`${label("Project:")} ${value(String(project.packageJson?.name ?? "unnamed"), c.bold)}`);
  console.log(`${label("Framework:")} ${value(project.framework ?? "unknown", c.cyan)}`);
  console.log(`${label("Question:")} ${value(question, c.yellow)}`);
  console.log();

  // Heuristic analysis — find relevant files and scripts
  const lowerQ = question.toLowerCase();

  // Script-related questions
  if (lowerQ.includes("build") || lowerQ.includes("compile")) {
    const scripts = (project.packageJson?.scripts ?? {}) as Record<string, string>;
    if (scripts.build) {
      ok(`Build command: ${project.packageManager} run build`);
      console.log(`  ${c.dim}Runs: ${scripts.build}${c.reset}`);
    } else {
      warn("No build script found in package.json");
    }
  }

  if (lowerQ.includes("test")) {
    const scripts = (project.packageJson?.scripts ?? {}) as Record<string, string>;
    if (scripts.test) {
      ok(`Test command: ${project.packageManager} test`);
      console.log(`  ${c.dim}Runs: ${scripts.test}${c.reset}`);
    } else {
      warn("No test script found");
    }
  }

  if (lowerQ.includes("lint") || lowerQ.includes("eslint")) {
    const scripts = (project.packageJson?.scripts ?? {}) as Record<string, string>;
    if (scripts.lint) {
      ok(`Lint command: ${project.packageManager} run lint`);
    } else {
      warn("No lint script found");
    }
  }

  if (lowerQ.includes("type") || lowerQ.includes("tsc") || lowerQ.includes("typescript")) {
    if (project.hasTsConfig) {
      ok("TypeScript is configured");
      ok(`Type-check: npx tsc --noEmit`);
    } else {
      warn("No tsconfig.json found");
    }
  }

  if (lowerQ.includes("deploy") || lowerQ.includes("vercel")) {
    if (existsSync(join(project.rootDir, "vercel.json"))) {
      ok("Vercel config found (vercel.json)");
    }
    if (existsSync(join(project.rootDir, "Dockerfile"))) {
      ok("Dockerfile found — self-hosting is supported");
    }
    ok("Deploy: npx vercel --prod");
  }

  if (lowerQ.includes("env") || lowerQ.includes("environment") || lowerQ.includes("secret")) {
    if (existsSync(join(project.rootDir, ".env.example"))) {
      ok(".env.example found — copy it to .env.local and fill in values");
    } else {
      warn("No .env.example found");
    }
    if (existsSync(join(project.rootDir, ".env.local"))) {
      ok(".env.local exists");
    } else {
      warn(".env.local not found — create it from .env.example");
    }
  }

  if (lowerQ.includes("git") || lowerQ.includes("branch") || lowerQ.includes("commit")) {
    if (project.hasGit) {
      ok(`Current branch: ${project.gitBranch}`);
      const changes = project.gitStatus ? project.gitStatus.split("\n").filter(Boolean) : [];
      ok(`${changes.length} uncommitted changes`);
    } else {
      fail("Not a git repository");
    }
  }

  // File search
  if (lowerQ.includes("file") || lowerQ.includes("where") || lowerQ.includes("find")) {
    const searchTerms = question.match(/["']([^"']+)["']/)?.[1] ?? "";
    if (searchTerms) {
      ok(`Searching for files matching "${searchTerms}"...`);
      // Simple file search in src/
      const srcDir = join(project.rootDir, "src");
      if (existsSync(srcDir)) {
        const matches = findFiles(srcDir, searchTerms);
        if (matches.length > 0) {
          for (const match of matches.slice(0, 10)) {
            console.log(`  ${c.green}${match}${c.reset}`);
          }
          if (matches.length > 10) {
            console.log(`  ${c.dim}... and ${matches.length - 10} more${c.reset}`);
          }
        } else {
          warn("No matching files found");
        }
      }
    }
  }

  // Generic advice
  if (lowerQ.includes("fix") || lowerQ.includes("error") || lowerQ.includes("bug")) {
    ok("Suggested steps:");
    console.log(`  1. Run ${c.cyan}npx tsc --noEmit${c.reset} to check for type errors`);
    console.log(`  2. Run ${c.cyan}${project.packageManager} run lint${c.reset} to check for lint errors`);
    console.log(`  3. Run ${c.cyan}${project.packageManager} test${c.reset} to run tests`);
    console.log(`  4. Run ${c.cyan}${project.packageManager} run build${c.reset} to verify the build`);
    console.log(`  5. Check ${c.cyan}git diff${c.reset} for recent changes that may have caused the issue`);
  }

  return 0;
}

function findFiles(dir: string, searchTerm: string): string[] {
  const results: string[] = [];
  const lowerSearch = searchTerm.toLowerCase();
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
        results.push(...findFiles(fullPath, searchTerm));
      } else if (entry.toLowerCase().includes(lowerSearch)) {
        results.push(fullPath.replace(process.cwd() + "/", "").replace(process.cwd() + "\\", ""));
      }
    }
  } catch {
    // ignore permission errors
  }
  return results;
}
