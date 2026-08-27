/**
 * litt inspect — Deep repo inspection.
 * Detects framework, auth, DB, deploy, scripts, directories, git state.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ok, fail, warn, header, label, value, detectProject, exec, c, resolveProjectCwd } from "../lib/utils.js";

export async function inspectCommand(_args: string[]): Promise<number> {
  const project = detectProject(resolveProjectCwd());

  header("Deep Inspection");

  // Project identity
  console.log(`${label("Root:")} ${value(project.rootDir, c.dim)}`);
  if (project.packageJson) {
    const pkg = project.packageJson;
    console.log(`${label("Name:")} ${value(String(pkg.name ?? "unnamed"), c.bold)}`);
    console.log(`${label("Version:")} ${value(String(pkg.version ?? "0.0.0"))}`);
    console.log(`${label("License:")} ${value(String(pkg.license ?? "none"))}`);
  }

  // Framework + stack
  header("Stack");
  if (project.framework) ok(`Framework: ${project.framework}`);
  else warn("No known framework detected");

  if (project.packageJson) {
    const deps = (project.packageJson.dependencies ?? {}) as Record<string, string>;
    const devDeps = (project.packageJson.devDependencies ?? {}) as Record<string, string>;
    const allDeps = { ...deps, ...devDeps };

    const stack: Array<[string, string]> = [
      ["Auth", "clerk"],
      ["Database", "supabase"],
      ["AI/LLM", "openrouter"],
      ["AI/LLM", "google/generative-ai"],
      ["Styling", "tailwindcss"],
      ["Testing", "vitest"],
      ["Deploy", "vercel"],
    ];

    for (const [category, pkg] of stack) {
      const found = Object.keys(allDeps).find((d) => d.includes(pkg));
      if (found) {
        console.log(`  ${label(category)} ${value(found, c.green)} ${c.dim}${allDeps[found]}${c.reset}`);
      }
    }

    console.log(`${label("Dependencies:")} ${value(String(Object.keys(deps).length))}`);
    console.log(`${label("DevDeps:")} ${value(String(Object.keys(devDeps).length))}`);
  }

  // Directory structure
  header("Directories");
  const importantDirs = ["src", "src/app", "src/lib", "src/components", "public", "tests", "docs", ".github"];
  for (const dir of importantDirs) {
    const fullPath = join(project.rootDir, dir);
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      const count = readdirSync(fullPath).length;
      ok(`${dir}/ (${count} items)`);
    }
  }

  // Scripts
  header("Scripts");
  if (project.packageJson?.scripts) {
    const scripts = project.packageJson.scripts as Record<string, string>;
    for (const [name, cmd] of Object.entries(scripts)) {
      console.log(`  ${c.cyan}${name.padEnd(12)}${c.reset} ${c.dim}${cmd}${c.reset}`);
    }
  } else {
    warn("No scripts defined");
  }

  // Git state
  header("Git");
  if (project.hasGit) {
    ok(`Branch: ${project.gitBranch}`);
    const lastCommit = exec("git log -1 --oneline");
    if (lastCommit.exitCode === 0) console.log(`  ${c.dim}Last: ${lastCommit.stdout}${c.reset}`);

    const changes = project.gitStatus ? project.gitStatus.split("\n").filter(Boolean) : [];
    if (changes.length === 0) {
      ok("Working tree clean");
    } else {
      warn(`${changes.length} changes:`);
      for (const change of changes.slice(0, 15)) {
        console.log(`  ${c.gray}${change}${c.reset}`);
      }
    }

    const remote = exec("git remote -v");
    if (remote.stdout) {
      console.log(`${label("Remote:")} ${value(remote.stdout.split("\n")[0] ?? "none", c.dim)}`);
    }
  } else {
    fail("Not a git repository");
  }

  // Config files
  header("Config Files");
  const configFiles = [
    "tsconfig.json",
    "next.config.ts",
    "next.config.js",
    "tailwind.config.ts",
    "tailwind.config.js",
    ".eslintrc.json",
    "eslint.config.mjs",
    "vitest.config.ts",
    ".env.local",
    ".env.example",
    "vercel.json",
    "Dockerfile",
  ];
  for (const file of configFiles) {
    if (existsSync(join(project.rootDir, file))) {
      ok(file);
    }
  }

  return 0;
}
