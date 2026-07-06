"use client";

import { AGENTS } from "@/lib/agents";
import { ANSI } from "./terminal-theme";

const hr = `${ANSI.dim}${"─".repeat(52)}${ANSI.reset}`;

export const DEFAULT_PROJECT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "README.md",
  "AGENTS.md",
  "vercel.json",
  "tsconfig.json",
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/app/lit-console/page.tsx",
  "src/app/lit-console/layout.tsx",
  "src/components/Navbar.tsx",
  "src/components/LayoutShell.tsx",
  "src/components/Sidebar.tsx",
  "src/components/lit-console/LitConsole.tsx",
  "src/components/lit-console/ChatPanel.tsx",
  "src/components/lit-console/CommandDock.tsx",
  "src/components/lit-console/TopBar.tsx",
  "src/components/lit-console/LeftRail.tsx",
  "src/components/terminal/LiTTreeTerminal.tsx",
  "src/lib/jarvis-context.ts",
  "src/lib/project-scan.ts",
  "src/lib/agents.ts",
  "src/lib/navigation.ts",
  "src/hooks/useClerkAuth.ts",
  "terminal-server/server.ts",
  "terminal-server/security.ts",
];

const FILE_CONTENTS: Record<string, string> = {
  "package.json": `{
  "name": "litlabs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "terminal:dev": "tsx terminal-server/server.ts",
    "dev:all": "concurrently \"pnpm dev\" \"pnpm terminal:dev\""
  },
  "dependencies": {
    "next": "^16.2.9",
    "react": "^19.2.7",
    "@clerk/nextjs": "^6.39.5",
    "@supabase/supabase-js": "^2.106.2",
    "socket.io-client": "^4.8.3",
    "@xterm/xterm": "^6.0.0"
  }
}`,
  "README.md": `# LiTTree Lab Studios

LiTTree OS is an AI agent operating system for creators and builders.

## Quick start

pnpm install
pnpm dev
pnpm terminal:dev

## Stack

Next.js 16, TypeScript 5, Tailwind CSS v4, Supabase, Clerk, Gemini.
`,
  "AGENTS.md": `# LiTTree Lab Studios - Project Guide

Quick Commands: pnpm dev, pnpm build, pnpm typecheck, pnpm check, pnpm dev:all.
Stack: Next.js 16, TypeScript 5, Tailwind CSS v4, Clerk, Supabase, Gemini 2.5 Flash.
`,
  "src/app/lit-console/page.tsx": `import LitConsoleClient from "./LitConsoleClient";

export default function LiTConsolePage() {
  return <LitConsoleClient />;
}
`,
  "src/lib/project-scan.ts": `import { readdirSync, statSync, readFileSync } from "fs";
import { resolve, join, relative } from "path";

export function getProjectFiles() {
  const tree: string[] = [];
  // scans src/app, src/components, src/lib, src/hooks, src/context, terminal-server
  return { tree, contents: new Map<string, string>() };
}
`,
};

const PROJECT_DIRS = new Set<string>();
for (const f of DEFAULT_PROJECT_FILES) {
  const parts = f.split("/").filter(Boolean);
  let path = "";
  for (let i = 0; i < parts.length - 1; i++) {
    path = path ? `${path}/${parts[i]}` : parts[i];
    PROJECT_DIRS.add(path);
  }
}

function normalizePath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return "/" + resolved.join("/");
}

function joinPath(cwd: string, target: string) {
  if (target.startsWith("/")) return target;
  return cwd === "/" ? `/${target}` : `${cwd}/${target}`;
}

function toRel(abs: string) {
  return abs.replace("/home/littree/litlabs", "").replace(/^\//, "");
}

function isProjectPath(path: string) {
  return path === "/home/littree/litlabs" || path.startsWith("/home/littree/litlabs/");
}

export class DemoShell {
  cwd = "/home/littree/litlabs";
  history: string[] = [];
  env: Record<string, string> = {
    NEXT_PUBLIC_TERMINAL_WS_URL: "",
    NODE_ENV: "production",
    HOME: "/home/littree",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };

  prompt() {
    const short = this.cwd.replace("/home/littree", "~");
    return `${ANSI.cyan}littree${ANSI.reset}${ANSI.dim}@studio${ANSI.reset}:${ANSI.green}${short}${ANSI.reset}$ `;
  }

  exec(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    this.history.push(trimmed);

    const [base, ...args] = trimmed.split(/\s+/);
    const lower = base.toLowerCase();

    switch (lower) {
      case "help":
        return this.help();
      case "clear":
        return "__CLEAR__";
      case "pwd":
        return this.cwd;
      case "cd":
        return this.cd(args[0] || "~");
      case "ls":
      case "ll":
      case "dir":
        return this.ls(args);
      case "cat":
        return this.cat(args[0] || "");
      case "find":
        return this.find(args);
      case "grep":
        return this.grep(args);
      case "tree":
        return this.tree();
      case "status":
        return this.status();
      case "agents":
        return this.agents();
      case "whoami":
        return this.whoami();
      case "env":
      case "printenv":
        return Object.entries(this.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n");
      case "echo":
        return args.join(" ");
      case "npm":
      case "pnpm":
      case "yarn":
        return this.pkg(lower, args);
      case "git":
        return this.git(args);
      case "node":
        return this.node(args);
      case "npx":
        return `npx ${args.join(" ")}\n${ANSI.dim}Run this in a real terminal session (deploy terminal-server).${ANSI.reset}`;
      case "vercel":
        return `vercel ${args.join(" ")}\n${ANSI.dim}Use your local CLI for deployments.${ANSI.reset}`;
      case "touch":
        return this.touch(args[0] || "");
      case "mkdir":
        return this.mkdir(args[0] || "");
      case "rm":
      case "rmdir":
        return `${ANSI.yellow}demo mode: file deletion is simulated${ANSI.reset}`;
      case "scan":
        return this.scan();
      case "deploy":
        return this.deploy();
      default:
        return `${ANSI.red}command not found: ${ANSI.reset}${ANSI.bold}${base}${ANSI.reset}\n${ANSI.dim}Type ${ANSI.reset}${ANSI.cyan}help${ANSI.reset}${ANSI.dim} for available commands.${ANSI.reset}`;
    }
  }

  help() {
    return [
      `${ANSI.bold}${ANSI.magenta}LiTTree Terminal — Demo Shell${ANSI.reset}`,
      hr,
      `  ${ANSI.cyan}ls, ll, dir${ANSI.reset}    — list files`,
      `  ${ANSI.cyan}cd <dir>${ANSI.reset}      — change directory`,
      `  ${ANSI.cyan}pwd${ANSI.reset}           — print working directory`,
      `  ${ANSI.cyan}cat <file>${ANSI.reset}    — show file contents`,
      `  ${ANSI.cyan}find, grep${ANSI.reset}     — search project`,
      `  ${ANSI.cyan}tree${ANSI.reset}          — directory tree`,
      `  ${ANSI.cyan}pnpm, npm, git${ANSI.reset} — package & version control`,
      `  ${ANSI.cyan}env, echo${ANSI.reset}     — environment helpers`,
      `  ${ANSI.cyan}agents, status${ANSI.reset}— platform info`,
      `  ${ANSI.cyan}clear${ANSI.reset}         — clear terminal`,
      hr,
      `${ANSI.dim}Tip: switch to real mode by deploying the terminal-server backend.${ANSI.reset}`,
    ].join("\n");
  }

  cd(target: string) {
    const resolved = target === "~" ? "/home/littree" : normalizePath(joinPath(this.cwd, target));
    if (!isProjectPath(resolved) && resolved !== "/home/littree") {
      return `${ANSI.red}cd: permission denied: ${target}${ANSI.reset}`;
    }
    if (resolved === "/home/littree" || resolved === "/home/littree/litlabs") {
      this.cwd = resolved;
      return "";
    }
    const rel = toRel(resolved);
    if (PROJECT_DIRS.has(rel) || DEFAULT_PROJECT_FILES.some((f) => f.startsWith(rel + "/"))) {
      this.cwd = resolved;
      return "";
    }
    return `${ANSI.red}cd: ${target}: No such file or directory${ANSI.reset}`;
  }

  ls(args: string[]) {
    const target = args.find((a) => !a.startsWith("-")) || ".";
    const long = args.some((a) => a.startsWith("-"));
    const resolved = normalizePath(joinPath(this.cwd, target));
    if (!isProjectPath(resolved)) return `${ANSI.red}ls: ${target}: No such file or directory${ANSI.reset}`;
    const rel = toRel(resolved);
    const prefix = rel ? rel + "/" : "";

    const dirs = new Set<string>();
    const files: string[] = [];
    for (const f of DEFAULT_PROJECT_FILES) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (!rest) continue;
      const parts = rest.split("/").filter(Boolean);
      if (parts.length === 1) {
        files.push(parts[0]);
      } else {
        dirs.add(parts[0]);
      }
    }

    const entries = [...Array.from(dirs).sort().map((d) => d + "/"), ...files.sort()];
    if (entries.length === 0) return long ? `${ANSI.dim}total 0${ANSI.reset}` : "";

    const lines = entries.map((name) => {
      const isFile = !name.endsWith("/");
      const fullPath = prefix + name.replace(/\/$/, "");
      if (long) {
        const size = isFile ? FILE_CONTENTS[fullPath]?.length ?? 0 : 0;
        return `${isFile ? "-rw-r--r--" : "drwxr-xr-x"} 1 littree littree ${size.toString().padStart(6)} ${isFile ? ANSI.cyan : ANSI.green}${name}${ANSI.reset}`;
      }
      return `${isFile ? ANSI.cyan : ANSI.green}${name}${ANSI.reset}`;
    });
    return long ? lines.join("\n") : lines.join("  ");
  }

  cat(file: string) {
    if (!file) return `${ANSI.red}cat: missing file${ANSI.reset}`;
    const resolved = normalizePath(joinPath(this.cwd, file));
    if (!isProjectPath(resolved)) {
      return `${ANSI.red}cat: ${file}: No such file or directory${ANSI.reset}`;
    }
    const rel = toRel(resolved);
    if (FILE_CONTENTS[rel]) return FILE_CONTENTS[rel];
    const exact = DEFAULT_PROJECT_FILES.find((f) => f === rel);
    if (exact) return `${ANSI.dim}<file content not loaded in demo: ${exact}>${ANSI.reset}`;
    // Try basename match
    const basename = rel.split("/").pop() || "";
    const match = DEFAULT_PROJECT_FILES.find((f) => f.endsWith(basename) && !f.endsWith("/"));
    if (match) return `${ANSI.dim}<file content not loaded in demo: ${match}>${ANSI.reset}`;
    return `${ANSI.red}cat: ${file}: No such file or directory${ANSI.reset}`;
  }

  find(args: string[]) {
    const path = args.find((a) => !a.startsWith("-")) || ".";
    const resolved = normalizePath(joinPath(this.cwd, path));
    if (!isProjectPath(resolved)) return `${ANSI.dim}No files found.${ANSI.reset}`;
    const rel = toRel(resolved);
    const prefix = rel ? rel + "/" : "";
    const matches = DEFAULT_PROJECT_FILES.filter((f) => f.startsWith(prefix) && !f.endsWith("/"));
    return matches.length ? matches.join("\n") : `${ANSI.dim}No files found.${ANSI.reset}`;
  }

  grep(args: string[]) {
    const pattern = args[args.length - 1] || "";
    if (!pattern) return `${ANSI.red}grep: missing pattern${ANSI.reset}`;
    const matches: string[] = [];
    for (const [file, content] of Object.entries(FILE_CONTENTS)) {
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(pattern.toLowerCase())) {
          matches.push(`${ANSI.cyan}${file}${ANSI.reset}:${i + 1}:${line}`);
        }
      });
    }
    return matches.length ? matches.join("\n") : `${ANSI.dim}No matches.${ANSI.reset}`;
  }

  tree() {
    const tree: string[] = ["/home/littree/litlabs"];
    const sorted = [...DEFAULT_PROJECT_FILES].sort();
    for (const file of sorted) {
      const parts = file.split("/").filter(Boolean);
      let path = "";
      for (let i = 0; i < parts.length; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        const display = "  ".repeat(i) + (i === parts.length - 1 ? parts[i] : parts[i] + "/");
        if (!tree.includes("/home/littree/litlabs/" + path) && !tree.includes(display)) {
          tree.push(display);
        }
      }
    }
    return tree.join("\n");
  }

  status() {
    return [
      `${ANSI.bold}${ANSI.cyan}System Status${ANSI.reset}`,
      hr,
      `  ${ANSI.green}●${ANSI.reset} Next.js 16 App Router    ${ANSI.green}online${ANSI.reset}`,
      `  ${ANSI.green}●${ANSI.reset} Supabase PostgreSQL       ${ANSI.green}online${ANSI.reset}`,
      `  ${ANSI.green}●${ANSI.reset} Gemini 2.5 Flash LLM     ${ANSI.green}online${ANSI.reset}`,
      `  ${ANSI.green}●${ANSI.reset} Clerk Auth                ${ANSI.green}online${ANSI.reset}`,
      `  ${ANSI.yellow}●${ANSI.reset} Terminal WebSocket        ${ANSI.yellow}demo mode${ANSI.reset}`,
      `  ${ANSI.green}●${ANSI.reset} Project Files             ${ANSI.green}loaded${ANSI.reset}`,
      hr,
      `  Workspace: ${ANSI.cyan}${this.cwd}${ANSI.reset}`,
      `  Files: ${ANSI.green}${DEFAULT_PROJECT_FILES.length}${ANSI.reset}`,
    ].join("\n");
  }

  agents() {
    const agentList = Object.values(AGENTS);
    const lines = [`${ANSI.bold}${ANSI.magenta}LiTTree Agents${ANSI.reset}  (${agentList.length} active)`, hr];
    for (const agent of agentList) {
      const dot = agent.status === "online" ? `${ANSI.green}●${ANSI.reset}` : `${ANSI.yellow}●${ANSI.reset}`;
      lines.push(`  ${dot} ${ANSI.bold}${agent.name}${ANSI.reset}  ${ANSI.dim}[${agent.tag}]${ANSI.reset} — ${agent.role}`);
    }
    return lines.join("\n");
  }

  whoami() {
    return [
      `${ANSI.bold}${ANSI.cyan}Current User${ANSI.reset}`,
      hr,
      `  Shell: ${ANSI.green}LiTTree Demo Terminal${ANSI.reset}`,
      `  Mode:  ${ANSI.yellow}demo${ANSI.reset} (read-only sandbox)`,
      `  Cwd:   ${ANSI.cyan}${this.cwd}${ANSI.reset}`,
      hr,
      `${ANSI.dim}Switch to real mode by deploying the terminal-server backend.${ANSI.reset}`,
    ].join("\n");
  }

  pkg(cmd: string, args: string[]) {
    const sub = args[0] || "";
    if (sub === "install" || sub === "i") {
      return `${ANSI.green}✓${ANSI.reset} ${cmd} install simulated (dependencies already installed)`;
    }
    if (sub === "build" || sub === "typecheck") {
      return [
        `${ANSI.bold}${ANSI.cyan}> ${cmd} ${sub}${ANSI.reset}`,
        hr,
        `  ${ANSI.green}✓${ANSI.reset} TypeScript check passed`,
        `  ${ANSI.green}✓${ANSI.reset} Next.js build completed`,
        `${ANSI.dim}(Run ${cmd} ${sub} in a real terminal for live output)${ANSI.reset}`,
      ].join("\n");
    }
    return `${ANSI.dim}${cmd} ${args.join(" ")} simulated in demo mode.${ANSI.reset}`;
  }

  git(args: string[]) {
    const sub = args[0] || "status";
    if (sub === "status") {
      return [
        `${ANSI.bold}${ANSI.cyan}On branch main${ANSI.reset}`,
        `${ANSI.dim}Your branch is up to date with 'origin/main'.${ANSI.reset}`,
        "",
        "nothing to commit, working tree clean",
      ].join("\n");
    }
    if (sub === "log") {
      return `${ANSI.dim}commit 962599cc — fix: blend console navigation with main site nav${ANSI.reset}`;
    }
    return `${ANSI.dim}git ${args.join(" ")} simulated in demo mode.${ANSI.reset}`;
  }

  node(args: string[]) {
    if (args[0] === "-v" || args[0] === "--version") return "v22.0.0";
    return `${ANSI.dim}node ${args.join(" ")} simulated in demo mode.${ANSI.reset}`;
  }

  touch(file: string) {
    if (!file) return `${ANSI.red}touch: missing file${ANSI.reset}`;
    return `${ANSI.dim}touch ${file}: simulated in demo mode.${ANSI.reset}`;
  }

  mkdir(dir: string) {
    if (!dir) return `${ANSI.red}mkdir: missing directory${ANSI.reset}`;
    return `${ANSI.dim}mkdir ${dir}: simulated in demo mode.${ANSI.reset}`;
  }

  scan() {
    return [
      `${ANSI.bold}${ANSI.yellow}Scanning project…${ANSI.reset}`,
      hr,
      `  ${ANSI.cyan}src/app/${ANSI.reset}           — Next.js pages & API routes`,
      `  ${ANSI.cyan}src/components/${ANSI.reset}    — React components`,
      `  ${ANSI.cyan}src/lib/${ANSI.reset}           — Core libraries & agents`,
      `  ${ANSI.cyan}src/hooks/${ANSI.reset}         — Custom React hooks`,
      `  ${ANSI.cyan}src/context/${ANSI.reset}       — React context providers`,
      `  ${ANSI.cyan}terminal-server/${ANSI.reset}   — Express + Socket.IO backend`,
      hr,
      `  Files: ${ANSI.green}${DEFAULT_PROJECT_FILES.length}${ANSI.reset}  |  TS errors: ${ANSI.green}0${ANSI.reset}`,
      `${ANSI.dim}Scan complete.${ANSI.reset}`,
    ].join("\n");
  }

  deploy() {
    return [
      `${ANSI.bold}${ANSI.magenta}Deploy Instructions${ANSI.reset}`,
      hr,
      `  1. ${ANSI.cyan}pnpm build${ANSI.reset}       — production build`,
      `  2. ${ANSI.cyan}pnpm check${ANSI.reset}       — lint + typecheck + build`,
      `  3. Push to ${ANSI.green}main${ANSI.reset} → Vercel auto-deploys`,
      "",
      `  ${ANSI.yellow}Terminal server:${ANSI.reset} deploy terminal-server/ to Fly.io or Railway`,
      `  ${ANSI.yellow}Frontend:${ANSI.reset} set NEXT_PUBLIC_TERMINAL_WS_URL to the server URL`,
      hr,
      `  Domain: ${ANSI.cyan}https://litlabs.net${ANSI.reset}`,
    ].join("\n");
  }
}
