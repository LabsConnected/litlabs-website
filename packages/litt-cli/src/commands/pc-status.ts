/**
 * litt pc status — one-shot workstation health report.
 *
 * Read-only: measures memory, CPU, GPU, Ollama, agent/dev processes,
 * dev-server listeners, WSL, and Tailscale/Dex reachability, then prints
 * findings. No daemons, no polling — every number is a live sample.
 */

import { ok, fail, warn, info, header, label, value, c } from "../lib/utils.js";
import {
  probeWindows,
  probeOllama,
  probeOllamaPsCli,
  probeTailscale,
  type PcProc,
} from "../lib/pc-probe.js";
import {
  probeScheduledTasks,
  classifyTaskHealth,
  isManagedTask,
} from "../lib/pc-tasks.js";
import { readPcState, PC_MODES } from "../lib/pc-state.js";
import { MODE_META } from "../lib/pc-plan.js";

const gb = (n: number) => `${n.toFixed(1)} GB`;
const mb = (n: number) => `${n} MB`;

type ProcClass =
  | "dev-server" | "mcp" | "devin" | "codex" | "ai" | "node-other" | "system";

function classify(p: PcProc): ProcClass {
  const n = p.name.toLowerCase();
  const cmd = (p.cmd ?? "").toLowerCase();
  if (n.startsWith("devin")) return "devin";
  if (n.startsWith("codex")) return "codex";
  if (n.startsWith("ollama") || n.startsWith("llama")) return "ai";
  if (n.startsWith("vmmem")) return "system";
  if (cmd.includes("mcp") && (cmd.includes("playwright") || cmd.includes("railway") || cmd.includes("cloudflare"))) return "mcp";
  if (cmd.includes("server.ts") || cmd.includes("terminal-server") || cmd.includes("dev-network") || cmd.includes("next") || cmd.includes("start-server") || cmd.includes("jest-worker")) return "dev-server";
  if (n === "node.exe") return "node-other";
  return "system";
}

function sumWs(procs: PcProc[]): number {
  return Math.round(procs.reduce((a, p) => a + (Number.isFinite(p.wsMb) ? p.wsMb : 0), 0));
}

/** Walk ppid chain to the topmost agent process (devin/codex), if any. */
function rootAgent(p: PcProc, byPid: Map<number, PcProc>): PcProc | null {
  let cur: PcProc | undefined = p;
  for (let i = 0; i < 8 && cur; i++) {
    if (cur.pid !== p.pid && (classify(cur) === "devin" || classify(cur) === "codex")) return cur;
    cur = byPid.get(cur.ppid);
  }
  return null;
}

function shortCmd(cmd: string | null): string {
  if (!cmd) return "";
  const s = cmd.replace(/^"?([^"\s]+node(?:\.exe)?)"?\s*/i, "").trim();
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

export async function pcStatusCommand(_args: string[]): Promise<number> {
  header("PC Status");

  if (process.platform !== "win32") {
    info("pc status currently reports Windows metrics only (probes return what they can).");
  }

  const win = probeWindows();
  const ollama = await probeOllama();
  const ollamaCli = probeOllamaPsCli();
  const ts = probeTailscale();
  const state = readPcState();

  // ── Mode ─────────────────────────────────────────────────────────
  if (state) {
    const meta = MODE_META[state.mode];
    ok(`Performance mode: ${value(meta.title, c.bold)} (${meta.purpose})`);
    console.log(`  ${c.gray}applied ${state.appliedAt} · preferred AI tier ${meta.preferredCtx} → ${meta.preferredModel}${c.reset}`);
  } else {
    info(`No performance mode set — run 'litt pc perf dev' (recommended default)`);
    console.log(`  ${c.gray}modes: ${PC_MODES.join(" | ")}${c.reset}`);
  }

  // ── Memory / CPU / GPU ───────────────────────────────────────────
  if (!win) {
    fail("System probe failed — showing what could be measured");
  } else {
    const usedGb = win.totalGb - win.freeGb;
    const usedPct = Math.round((usedGb / win.totalGb) * 100);
    header("Memory & CPU");
    console.log(`${label("RAM:")} ${value(`${gb(usedGb)} / ${gb(win.totalGb)} used (${usedPct}%) · ${gb(win.freeGb)} free`, usedPct > 85 ? c.yellow : c.reset)}`);
    console.log(`${label("Committed:")} ${value(`${gb(win.committedGb)} / ${gb(win.commitLimitGb)}`, c.reset)} ${c.gray}(includes address-space reservations — pressure only matters near the limit)${c.reset}`);
    if (win.pagefilePct !== null) {
      console.log(`${label("Pagefile:")} ${value(`${win.pagefilePct}%`, win.pagefilePct > 20 ? c.yellow : c.reset)} ${c.gray}in use — sustained high values mean real memory pressure${c.reset}`);
    }
    console.log(`${label("CPU:")} ${value(win.cpuPct !== null ? `${win.cpuPct}%` : "n/a")}`);
    console.log(`${label("Power:")} ${value(win.powerScheme ?? "unknown")}`);
    if (win.gpu) {
      console.log(`${label("GPU:")} ${value(`${win.gpu.name} · ${win.gpu.utilPct}% · VRAM ${win.gpu.vramUsedMb}/${win.gpu.vramTotalMb} MiB`)}`);
    }
  }

  // ── Ollama / AI ──────────────────────────────────────────────────
  header("Local AI (Ollama)");
  if (!ollama.reachable) {
    info("Ollama daemon not reachable on 127.0.0.1:11434");
  } else {
    ok(`Ollama ${ollama.version ?? ""} reachable`);
    if (ollamaCli.length === 0) {
      console.log(`  ${c.gray}no model loaded — idle (keep-alive 5m auto-unloads)${c.reset}`);
    }
    for (const m of ollamaCli) {
      const api = ollama.loaded.find((x) => x.name === m.name);
      console.log(`  ${c.cyan}${m.name}${c.reset} · ${api ? gb(api.sizeGb) : "?"} · ${m.processor || "?"} · ctx ${m.context ?? "?"}${api?.expiresAt ? ` · unloads ${new Date(api.expiresAt).toLocaleTimeString()}` : ""}`);
    }
    const aiProcs = win?.procs.filter((p) => classify(p) === "ai") ?? [];
    if (aiProcs.length > 0) {
      console.log(`  ${c.gray}daemon+runner RAM: ${mb(sumWs(aiProcs))}${c.reset}`);
    }
  }
  if (process.env.OLLAMA_HOST === "0.0.0.0") {
    warn(`OLLAMA_HOST=0.0.0.0 — bound to all interfaces (required for Dex). Check firewall allows are Tailscale-scoped only.`);
  }

  // ── Agents & dev processes ───────────────────────────────────────
  if (win) {
    header("Agents & Dev Processes");
    const groups = new Map<ProcClass, PcProc[]>();
    for (const p of win.procs) {
      const k = classify(p);
      if (k === "system") continue;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const order: [ProcClass, string][] = [
      ["dev-server", "Dev-server tree"], ["devin", "Devin agents"], ["mcp", "MCP servers"],
      ["codex", "Codex agents"], ["node-other", "Other Node"], ["ai", "AI runtimes"],
    ];
    for (const [k, title] of order) {
      const ps = groups.get(k);
      if (!ps?.length) continue;
      console.log(`${label(title + ":")} ${ps.length} proc · ${mb(sumWs(ps))}`);
    }

    const listeners = win.listeners.filter((l) => l.port !== 11434);
    if (listeners.length > 0) {
      header("Dev Server Listeners");
      const seen = new Set<number>();
      for (const l of listeners) {
        // Windows reports stale pid=0 listener rows alongside the real
        // owner — one display line per port.
        if (seen.has(l.port)) continue;
        seen.add(l.port);
        const real = listeners.find((x) => x.port === l.port && x.pid !== 0) ?? l;
        const owner = win.procs.find((p) => p.pid === real.pid);
        const ownerDesc = owner ? `${owner.name} pid ${real.pid} · ${mb(owner.wsMb)}${owner.cmd ? ` · ${shortCmd(owner.cmd)}` : ""}` : `pid ${real.pid}`;
        console.log(`  ${c.cyan}:${l.port}${c.reset} ${real.addr} · ${ownerDesc}`);
      }
    }
  }

  // ── WSL ──────────────────────────────────────────────────────────
  header("WSL");
  if (win && win.vmmemMb > 0) {
    console.log(`${label("vmmem:")} ${mb(win.vmmemMb)}`);
  }
  const wslLines = (win?.wslText ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^NAME/i.test(l));
  if (wslLines.length === 0) {
    info("No WSL distros listed (or wsl.exe unavailable)");
  } else {
    for (const l of wslLines) console.log(`  ${c.gray}${l}${c.reset}`);
  }

  // ── Tailscale / Dex ──────────────────────────────────────────────
  header("Tailscale / Android Dex");
  if (!ts.up) {
    info("Tailscale not running (or CLI unavailable)");
  } else {
    ok(`Tailscale up${ts.selfIp ? ` · self ${ts.selfIp}` : ""}`);
    const android = ts.peers.filter((p) => p.os === "android");
    for (const p of android) {
      console.log(`  ${c.cyan}${p.name}${c.reset} ${p.ip} · ${p.online ? "online" : "offline"}${p.idle ? " (idle)" : " (active)"}`);
    }
    const dexFwd = win?.listeners.find((l) => l.port === 8022);
    console.log(`  ${c.gray}dex ssh forward :8022 ${dexFwd ? "listening" : "not listening"}${c.reset}`);
  }

  // ── Scheduled Tasks ──────────────────────────────────────────────
  const taskSnap = probeScheduledTasks();
  header("Scheduled Tasks");
  if (!taskSnap) {
    info("Task Scheduler probe unavailable (non-Windows or query failed)");
  } else {
    const managed = taskSnap.tasks.filter(isManagedTask);
    const healths = managed.map((t) => ({ t, h: classifyTaskHealth(t, Date.now()) }));
    const enabled = healths.filter(({ t }) => t.state !== "Disabled");
    const disabledCount = healths.length - enabled.length;
    const bad = enabled.filter(({ h }) => h.level === "warning" || h.level === "critical");
    const running = enabled.filter(({ t }) => t.state === "Running");
    if (bad.length === 0) {
      ok(`${enabled.length} enabled tasks healthy${running.length > 0 ? ` · ${running.length} running now` : ""}`);
    } else {
      ok(`${enabled.length - bad.length}/${enabled.length} enabled tasks healthy${running.length > 0 ? ` · ${running.length} running now` : ""}`);
      for (const { t, h } of bad) {
        (h.level === "critical" ? fail : warn)(`${t.name} — ${h.summary}`);
      }
    }
    if (disabledCount > 0) {
      info(`${disabledCount} disabled LiTT task${disabledCount === 1 ? "" : "s"} kept for record`);
    }
    console.log(`  ${c.gray}detail: litt pc tasks${c.reset}`);
  }

  // ── Findings ─────────────────────────────────────────────────────
  const findings: { ok: boolean; text: string }[] = [];
  if (win) {
    const devServers = win.listeners.filter((l) => [3000, 3001, 3002, 3003, 5173, 8000, 8080].includes(l.port));
    if (devServers.length <= 1) findings.push({ ok: true, text: "No duplicate dev servers" });
    else findings.push({ ok: false, text: `${devServers.length} dev-server listeners — check for duplicates` });

    const mcps = win.procs.filter((p) => classify(p) === "mcp");
    const byPid = new Map(win.procs.map((p) => [p.pid, p]));
    const orphanMcps = mcps.filter((p) => !rootAgent(p, byPid));
    if (orphanMcps.length > 0) {
      findings.push({ ok: false, text: `${orphanMcps.length}/${mcps.length} MCP procs have no live agent parent — possible orphans` });
    } else {
      findings.push({ ok: true, text: `All ${mcps.length} MCP procs belong to live agent sessions` });
    }

    const usedPct = Math.round(((win.totalGb - win.freeGb) / win.totalGb) * 100);
    if (win.freeGb < 3) findings.push({ ok: false, text: `Only ${gb(win.freeGb)} free — memory pressure likely` });
    else if (usedPct > 80) findings.push({ ok: false, text: `${usedPct}% RAM used — watch for pressure under load` });
    else findings.push({ ok: true, text: `${gb(win.freeGb)} free — healthy headroom` });

    if (win.pagefilePct !== null && win.pagefilePct > 20) {
      findings.push({ ok: false, text: `Pagefile ${win.pagefilePct}% — sustained paging hurts responsiveness` });
    }
  }
  if (taskSnap) {
    const managed = taskSnap.tasks.filter(isManagedTask);
    const problems = managed
      .map((t) => ({ t, h: classifyTaskHealth(t, Date.now()) }))
      .filter(({ h }) => h.level === "warning" || h.level === "critical");
    if (problems.length === 0) {
      findings.push({ ok: true, text: "Scheduled tasks: no warnings" });
    } else {
      findings.push({
        ok: false,
        text: `${problems.length} scheduled task${problems.length === 1 ? " needs" : "s need"} attention — run 'litt pc tasks'`,
      });
    }
  }
  if (findings.length > 0) {
    header("Findings");
    for (const f of findings) (f.ok ? ok : warn)(f.text);
  }

  console.log(`\n${c.dim}Modes: litt pc perf light | dev | max — add --dry-run to preview${c.reset}`);
  return 0;
}
