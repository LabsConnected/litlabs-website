/**
 * litt status — Show project + auth + git status.
 * Quick overview of the current project state.
 */

import { ok, fail, warn, header, label, value, detectProject, c } from "../lib/utils.js";

export async function statusCommand(_args: string[]): Promise<number> {
  const project = detectProject();

  header("Project Status");

  if (project.hasPackageJson) {
    const pkg = project.packageJson!;
    console.log(`${label("Name:")} ${value(String(pkg.name ?? "unnamed"), c.bold)}`);
    console.log(`${label("Version:")} ${value(String(pkg.version ?? "0.0.0"))}`);
    if (project.framework) console.log(`${label("Framework:")} ${value(project.framework, c.cyan)}`);
    console.log(`${label("Package Mgr:")} ${value(project.packageManager ?? "npm", c.blue)}`);
    console.log(`${label("TypeScript:")} ${project.hasTsConfig ? value("configured", c.green) : value("not configured", c.yellow)}`);
  } else {
    fail("No package.json found");
    return 1;
  }

  header("Git");
  if (project.hasGit) {
    ok(`Branch: ${project.gitBranch}`);
    const changes = project.gitStatus ? project.gitStatus.split("\n").filter(Boolean) : [];
    if (changes.length === 0) {
      ok("Working tree clean");
    } else {
      warn(`${changes.length} uncommitted change(s):`);
      for (const change of changes.slice(0, 10)) {
        console.log(`  ${c.gray}${change}${c.reset}`);
      }
      if (changes.length > 10) {
        console.log(`  ${c.dim}... and ${changes.length - 10} more${c.reset}`);
      }
    }
  } else {
    fail("Not a git repository");
  }

  header("Scripts");
  if (project.packageJson?.scripts) {
    const scripts = project.packageJson.scripts as Record<string, string>;
    const commonScripts = ["dev", "build", "test", "lint", "start"];
    for (const name of commonScripts) {
      if (scripts[name]) {
        console.log(`  ${c.green}pnpm run ${name}${c.reset} ${c.dim}— ${scripts[name]}${c.reset}`);
      }
    }
    const extraScripts = Object.keys(scripts).filter((s) => !commonScripts.includes(s));
    for (const name of extraScripts.slice(0, 5)) {
      console.log(`  ${c.blue}pnpm run ${name}${c.reset} ${c.dim}— ${scripts[name]}${c.reset}`);
    }
    if (extraScripts.length > 5) {
      console.log(`  ${c.dim}... and ${extraScripts.length - 5} more scripts${c.reset}`);
    }
  } else {
    warn("No scripts defined in package.json");
  }

  return 0;
}
