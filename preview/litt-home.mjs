#!/usr/bin/env node
/**
 * LiTT Home — standalone preview (isolated; does NOT replace installed `litt`).
 *
 * A phone-width home screen: live local facts, honest LIVE / NOT CONNECTED /
 * UNAVAILABLE labels, a menu that launches existing paths only (dex, litt,
 * litt-menu), and clean exit. Read-only status collection; zero new deps —
 * Ink + React are resolved from the already-installed litt-cli package.
 *
 * Run (Termux):   node ~/litt-worktrees/litt-home-preview/preview/litt-home.mjs
 * Run (proot):    node /data/data/com.termux/files/home/litt-worktrees/litt-home-preview/preview/litt-home.mjs
 * Non-TTY:        prints a plain-text snapshot and exits 0.
 */

import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname } from "node:path";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));

// -- dep resolution: reuse already-installed litt-cli's ink + react --------
const PKG_CANDIDATES = [
  process.env.LITT_CLI_PKG,                                    // explicit override
  `${HERE}/../../litt-canonical/packages/litt-cli/package.json`,         // worktree beside canonical (Termux ~)
  `${HERE}/../packages/litt-cli/package.json`,                 // inside a repo checkout
  "/root/litt-canonical/packages/litt-cli/package.json",       // proot canonical
  "/data/data/com.termux/files/home/litt-canonical/packages/litt-cli/package.json",
  "/data/data/com.termux/files/usr/lib/node_modules/@litlabs1/litt-cli/package.json", // installed pkg
];
let req = null;
for (const c of PKG_CANDIDATES.filter(Boolean)) {
  try {
    const r = createRequire(c);
    r.resolve("ink");
    r.resolve("react");
    req = r;
    break;
  } catch { /* next candidate */ }
}
if (!req) {
  console.error("litt-home: could not resolve ink/react from an installed " +
    "litt-cli. Set LITT_CLI_PKG=/path/to/litt-cli/package.json");
  process.exit(1);
}
const ink = await import(pathToFileURL(req.resolve("ink")).href);
const reactMod = await import(pathToFileURL(req.resolve("react")).href);
const React = reactMod.default?.useState ? reactMod.default : reactMod;
const { render, Box, Text, useApp, useInput } = ink;
const { useState, useEffect } = React;
const h = React.createElement;

// -- read-only status collection (all bounded, all honest) -----------------
function sh(cmd, args, ms = 3000) {
  try {
    return execFileSync(cmd, args, {
      timeout: ms, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch { return null; }
}
const have = (bin) => sh("sh", ["-c", `command -v ${bin}`], 1500) !== null;

function httpJson(url, ms = 1500) {
  return new Promise((resolve) => {
    const r = http.get(url, { timeout: ms }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    r.on("timeout", () => { r.destroy(); resolve(null); });
    r.on("error", () => resolve(null));
  });
}

const isTermux = (process.env.PREFIX || "").includes("com.termux");
const HOME_DIR = isTermux ? "/data/data/com.termux/files/home" : os.homedir();
// private-agent lives on the Termux side; it's visible from both environments.
const AGENT_DIR = [
  "/data/data/com.termux/files/home/private-agent",
  `${HOME_DIR}/private-agent`,
].find((d) => fs.existsSync(`${d}/agent.py`)) || `${HOME_DIR}/private-agent`;

/** Resolve a launchable path for a binary: PATH first, then ~/bin. */
function resolveBin(name) {
  const onPath = sh("sh", ["-c", `command -v ${name}`], 1500);
  if (onPath) return onPath;
  for (const dir of [`${HOME_DIR}/bin`, "/data/data/com.termux/files/home/bin",
    "/data/data/com.termux/files/usr/bin"]) {
    if (fs.existsSync(`${dir}/${name}`)) return `${dir}/${name}`;
  }
  return null;
}

async function collect() {
  // repo: prefer cwd, else canonical checkout
  let repo = null;
  for (const dir of [process.cwd(), `${HOME_DIR}/litt-canonical`, "/root/litt-canonical"]) {
    const top = sh("git", ["-C", dir, "rev-parse", "--show-toplevel"], 2000);
    if (top) {
      const branch = sh("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]) || "?";
      const dirty = (sh("git", ["-C", dir, "status", "--porcelain"]) || "")
        .split("\n").filter(Boolean).length;
      const sha = (sh("git", ["-C", dir, "rev-parse", "--short", "HEAD"]) || "").trim();
      repo = { path: top, branch, dirty, sha };
      break;
    }
  }
  // Dex readiness is three SEPARATE facts — never merge them into one label:
  //   1. launcher files: `dex` binary + deployed agent.py exist on disk
  //   2. ollama api: the model server answers /api/ps
  //   3. brain: a model is actually resident (or idle but pulled)
  const dexBin = resolveBin("dex");
  const dexAgent = fs.existsSync(`${AGENT_DIR}/agent.py`);
  const ps = await httpJson("http://127.0.0.1:11434/api/ps");
  const tags = await httpJson("http://127.0.0.1:11434/api/tags");
  // github / railway: these labels mean *authenticated CLI availability*
  // only — NOT verified service health. Never claim more than was checked.
  const gh = have("gh")
    ? (sh("gh", ["auth", "status"], 3000) !== null || sh("gh", ["auth", "token"], 2000) !== null
        ? "LIVE" : "NOT CONNECTED")
    : "UNAVAILABLE";
  const railway = have("railway")
    ? ((sh("railway", ["whoami"], 4000) || "").includes("Logged in") ? "LIVE" : "NOT CONNECTED")
    : "UNAVAILABLE";
  return {
    repo,
    dexBin,
    dexAgent,
    littBin: resolveBin("litt"),
    littMenu: resolveBin("litt-menu"),
    ollama: ps === null ? "down" : "up",
    modelsLoaded: ps?.models?.length ?? 0,
    modelName: ps?.models?.[0]?.name || null,
    modelsPulled: tags?.models?.length ?? 0,
    gh,
    railway,
    lane: isTermux ? "termux" : "proot",
  };
}

// -- plain-text fallback (non-TTY) ------------------------------------------
function dexFilesState(s) {
  return s.dexBin && s.dexAgent ? "LIVE" : "UNAVAILABLE";
}
function dexFilesValue(s) {
  if (!s.dexBin && !s.dexAgent) return "launcher + agent missing";
  if (!s.dexBin) return "launcher missing";
  if (!s.dexAgent) return "agent.py missing";
  return "launcher + agent v1.19 on disk";
}
function ollamaValue(s) {
  if (s.ollama !== "up") return "api not reachable";
  return s.modelName
    ? `up · ${s.modelName.replace(/.*\//, "")} loaded`
    : `up · idle (${s.modelsPulled} pulled)`;
}

function printStatic(s) {
  const line = (k, v, st) => console.log(`  ${k.padEnd(9)} ${v.padEnd(34)} ${st}`);
  console.log("◬ LiTT Home (preview) — non-interactive snapshot");
  if (s.repo) line("project", `${s.repo.path.replace(/^.*\//, "")} · ${s.repo.branch} · ${s.repo.sha}` + (s.repo.dirty ? ` +${s.repo.dirty}` : " clean"), "LIVE");
  else line("project", "no git repo found", "UNAVAILABLE");
  line("dex", dexFilesValue(s), dexFilesState(s));
  line("ollama", ollamaValue(s), s.ollama === "up" ? "LIVE" : "NOT CONNECTED");
  line("gh cli", s.gh === "LIVE" ? "authenticated" : s.gh.toLowerCase(), s.gh);
  line("railway", s.railway === "LIVE" ? "cli logged in" : s.railway.toLowerCase(), s.railway);
  line("n8n", "not wired yet", "UNAVAILABLE");
  line("trig.dev", "not integrated", "UNAVAILABLE");
  console.log("\n  Interactive UI requires a TTY: run this in Termux/a real terminal.");
}

// -- Ink UI ------------------------------------------------------------------
// Phone-width adaptive: everything is derived from the real terminal width,
// clamped so a 40-col Termux screen still renders clean rows.
const COLS = Math.max(36, Math.min(process.stdout.columns || 80, 64));
const ROW_W = COLS - 4;
const LABEL_W = COLS <= 44 ? 8 : 9;
const STATE_W = COLS <= 44 ? 5 : 13;
const VALUE_W = Math.max(10, ROW_W - LABEL_W - STATE_W - 4);
const clip = (s, w) => (s.length > w ? s.slice(0, Math.max(1, w - 1)) + "…" : s);
const STATE_COLOR = { LIVE: "green", "NOT CONNECTED": "yellow", UNAVAILABLE: "gray" };
const STATE_SHORT = { LIVE: "LIVE", "NOT CONNECTED": "N/C", UNAVAILABLE: "N/A" };

function StatusRow({ label, value, state }) {
  const shown = COLS <= 44 ? (STATE_SHORT[state] || state) : state;
  return h(Box, null,
    h(Text, { color: "gray" }, "  " + label.padEnd(LABEL_W).slice(0, LABEL_W)),
    h(Text, null, clip(value, VALUE_W).padEnd(VALUE_W)),
    h(Text, { color: STATE_COLOR[state] || "gray" }, shown));
}

function App({ done }) {
  const { exit } = useApp();
  const [snap, setSnap] = useState(null);
  const [sel, setSel] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => { collect().then(setSnap); }, [tick]);

  const items = [
    { k: "dex", label: "Dex", note: snap?.dexBin ? "private agent" : "missing", bin: snap?.dexBin },
    { k: "litt", label: "litt cockpit", note: snap?.littBin ? "installed CLI" : "missing", bin: snap?.littBin },
    { k: "menu", label: "litt-menu", note: snap?.littMenu ? "ops launcher" : "missing", bin: snap?.littMenu },
    { k: "refresh", label: "Refresh", note: "re-read status" },
    { k: "quit", label: "Quit", note: "" },
  ];

  useInput((input, key) => {
    const bare = input && !key.ctrl && !key.meta;
    if (key.escape || (key.ctrl && input === "c") || (bare && input === "q")) { done("quit"); exit(); return; }
    if (key.upArrow || (bare && input === "k")) { setSel((s) => (s + items.length - 1) % items.length); return; }
    if (key.downArrow || (bare && input === "j")) { setSel((s) => (s + 1) % items.length); return; }
    if (bare && input === "d") { if (snap?.dexBin) { done({ k: "dex", bin: snap.dexBin }); exit(); } return; }
    if (bare && input === "l") { if (snap?.littBin) { done({ k: "litt", bin: snap.littBin }); exit(); } return; }
    if (bare && input === "r") { setTick((t) => t + 1); return; }
    if (key.return) {
      const it = items[sel];
      if (it.k === "refresh") { setTick((t) => t + 1); return; }
      if (!it.bin && (it.k === "dex" || it.k === "litt" || it.k === "menu")) return;  // missing binary: stay put
      done(it.k === "menu" ? { k: "menu", bin: it.bin } : { k: it.k, bin: it.bin ?? null });
      exit();
    }
  });

  const s = snap;
  return h(Box, { flexDirection: "column", width: COLS },
    h(Text, { bold: true, color: "cyan" }, "◬ LiTT Home", "  ", h(Text, { color: "gray" }, `preview · ${s?.lane || ""}`)),
    h(Text, { color: "gray" }, "  " + "─".repeat(ROW_W)),
    !s
      ? h(Text, { color: "gray" }, "  reading status…")
      : h(React.Fragment, null,
          s.repo
            ? h(StatusRow, { label: "project", state: "LIVE",
                value: `${s.repo.path.replace(/^.*\//, "")} · ${s.repo.branch} · ${s.repo.sha}${s.repo.dirty ? ` +${s.repo.dirty}` : " clean"}` })
            : h(StatusRow, { label: "project", value: "no git repo found", state: "UNAVAILABLE" }),
          h(StatusRow, { label: "dex", state: dexFilesState(s), value: dexFilesValue(s) }),
          h(StatusRow, { label: "ollama", state: s.ollama === "up" ? "LIVE" : "NOT CONNECTED", value: ollamaValue(s) }),
          h(StatusRow, { label: "gh cli", state: s.gh, value: s.gh === "LIVE" ? "authenticated" : s.gh.toLowerCase() }),
          h(StatusRow, { label: "railway", state: s.railway, value: s.railway === "LIVE" ? "cli logged in" : s.railway.toLowerCase() }),
          h(StatusRow, { label: "n8n", value: "not wired yet", state: "UNAVAILABLE" }),
          h(StatusRow, { label: "trig.dev", value: "not integrated", state: "UNAVAILABLE" })),
    h(Text, { color: "gray" }, "  " + "─".repeat(ROW_W)),
    ...items.map((it, i) =>
      h(Box, { key: it.k },
        h(Text, { color: i === sel ? "cyan" : "gray" }, i === sel ? " › " : "   "),
        h(Text, { bold: i === sel }, it.label.padEnd(14)),
        h(Text, { color: "gray" }, it.note))),
    h(Text, { color: "gray" }, "  " + "─".repeat(ROW_W)),
    h(Text, { color: "gray" }, clip("  ↑/↓ select · enter open · d dex · r refresh · q quit", ROW_W)));
}

async function runUI() {
  return new Promise((resolve) => {
    const inst = render(h(App, { done: resolve }), { exitOnCtrlC: true });
    inst.waitUntilExit().then(() => resolve("quit"));
  });
}

async function main() {
  if (!process.stdout.isTTY) { printStatic(await collect()); return; }
  const SPAWN = { dex: "dex", litt: "litt", menu: "litt-menu" };
  while (true) {
    const action = await runUI();
    if (!action || action === "quit") break;
    const bin = action.bin || SPAWN[action.k];
    if (!bin) continue;                            // nothing to launch
    if (action.k in SPAWN) spawnSync(bin, [], { stdio: "inherit" });  // existing launch paths only
  }
  process.exit(0);
}
main();
