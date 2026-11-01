/**
 * PC probe — lightweight, on-demand system measurements for `litt pc`.
 *
 * Design contract:
 *  - On-demand only. No daemons, no polling, no background work.
 *  - Failure-tolerant. A missing tool, denied counter, or down daemon
 *    degrades to null fields — never a crash, never a fake success.
 *  - One PowerShell spawn for the expensive system query; cheap native
 *    calls (nvidia-smi is folded into that same spawn) plus one HTTP
 *    probe to the Ollama API and one tailscale CLI call.
 *  - Command lines are sanitized (secrets redacted, truncated) before
 *    they ever reach stdout or state files.
 */

import { exec } from "./utils.js";

export interface PcProc {
  pid: number;
  name: string;
  ppid: number;
  wsMb: number;
  privMb: number;
  cmd: string | null;
}

export interface PcListener {
  port: number;
  addr: string;
  pid: number;
}

export interface GpuInfo {
  name: string;
  vramUsedMb: number;
  vramTotalMb: number;
  utilPct: number;
}

export interface WinSnapshot {
  totalGb: number;
  freeGb: number;
  commitLimitGb: number;
  committedGb: number;
  pagefilePct: number | null;
  cpuPct: number | null;
  powerScheme: string | null;
  powerSchemeGuid: string | null;
  gpu: GpuInfo | null;
  procs: PcProc[];
  listeners: PcListener[];
  vmmemMb: number;
  wslText: string;
}

export interface OllamaLoaded {
  name: string;
  sizeGb: number;
  processor: string;
  context: number | null;
  expiresAt: string | null;
}

export interface OllamaSnapshot {
  reachable: boolean;
  version: string | null;
  loaded: OllamaLoaded[];
}

export interface TailscalePeer {
  name: string;
  ip: string;
  os: string;
  online: boolean;
  idle: boolean;
}

export interface TailscaleSnapshot {
  up: boolean;
  selfIp: string | null;
  peers: TailscalePeer[];
}

/** PowerShell probe — single spawn, emits JSON. */
const PS_PROBE = `
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = $null
try { $cpu = [math]::Round((Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue, 1) } catch {}
$pf = $null
try { $pf = [math]::Round((Get-Counter '\\Paging File(_Total)\\% Usage' -ErrorAction Stop).CounterSamples[0].CookedValue, 2) } catch {}
$scheme = $null; $guid = $null
$schemeLine = (powercfg /getactivescheme) -join ' '
if ($schemeLine -match 'GUID:\\s*([0-9a-fA-F-]+)\\s*\\((.+)\\)') { $guid = $Matches[1]; $scheme = $Matches[2].Trim() }
$gpu = $null
$nv = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nv) {
  $row = (nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits) | Select-Object -First 1
  if ($row) {
    $parts = $row -split ',\\s*'
    if ($parts.Count -ge 4) { $gpu = @{ name=$parts[0]; vramUsedMb=[int]$parts[1]; vramTotalMb=[int]$parts[2]; utilPct=[int]$parts[3] } }
  }
}
$names = @('node','ollama','llama','devin','codex','vmmem','cmd','pwsh','conhost')
$procs = @(Get-CimInstance Win32_Process | Where-Object {
  $n = $_.Name.ToLower()
  $hit = $false
  foreach ($p in $names) { if ($n.StartsWith($p)) { $hit = $true; break } }
  $hit
} | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  $cl = $_.CommandLine
  if ($cl) {
    $cl = $cl -replace '(KEY|TOKEN|SECRET|PASSWORD|PASS)=([^\\s"'']+)','$1=[R]'
    if ($cl.Length -gt 140) { $cl = $cl.Substring(0,140) }
  }
  @{ pid=$_.ProcessId; name=$_.Name; ppid=$_.ParentProcessId;
     ws= $(if ($p) { [int]($p.WorkingSet64/1MB) } else { 0 });
     priv= $(if ($p) { [int]($p.PrivateMemorySize64/1MB) } else { 0 });
     cmd=$cl }
})
$ports = @(3000,3001,3002,3003,4000,4001,5173,8000,8001,8022,8080,8443,11434)
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $ports -contains $_.LocalPort } | ForEach-Object {
  @{ port=$_.LocalPort; addr=$_.LocalAddress.ToString(); pid=$_.OwningProcess }
})
$vmmem = (Get-Process vmmem* | Measure-Object WorkingSet64 -Sum).Sum
$wsl = ((wsl.exe -l -v 2>$null) -replace "\\0",'' | Out-String).Trim()
@{
  totalGb=[math]::Round($os.TotalVisibleMemorySize/1MB,1);
  freeGb=[math]::Round($os.FreePhysicalMemory/1MB,1);
  commitLimitGb=[math]::Round($os.TotalVirtualMemorySize/1MB,1);
  committedGb=[math]::Round(($os.TotalVirtualMemorySize-$os.FreeVirtualMemory)/1MB,1);
  pagefilePct=$pf; cpuPct=$cpu; powerScheme=$scheme; powerSchemeGuid=$guid;
  gpu=$gpu; procs=$procs; listeners=$listeners;
  vmmemMb= $(if ($vmmem) { [int]($vmmem/1MB) } else { 0 });
  wsl=$wsl
} | ConvertTo-Json -Depth 6 -Compress
`;

export function probeWindows(): WinSnapshot | null {
  if (process.platform !== "win32") return null;
  const r = exec(PS_PROBE, { timeout: 20_000 });
  // Don't gate on exitCode: $LASTEXITCODE in the wrapper reflects the last
  // native call inside the script (wsl -l -v), which may be nonzero while
  // the JSON payload still printed fine. stdout is the real contract.
  if (!r.stdout) return null;
  try {
    const j = JSON.parse(r.stdout);
    return {
      totalGb: j.totalGb ?? 0,
      freeGb: j.freeGb ?? 0,
      commitLimitGb: j.commitLimitGb ?? 0,
      committedGb: j.committedGb ?? 0,
      pagefilePct: j.pagefilePct ?? null,
      cpuPct: j.cpuPct ?? null,
      powerScheme: j.powerScheme ?? null,
      powerSchemeGuid: j.powerSchemeGuid ?? null,
      gpu: j.gpu ?? null,
      procs: (Array.isArray(j.procs) ? j.procs : j.procs ? [j.procs] : []).map(
        (p: { pid?: unknown; name?: unknown; ppid?: unknown; ws?: unknown; priv?: unknown; cmd?: unknown }) => ({
          pid: Number(p.pid) || 0,
          name: String(p.name ?? ""),
          ppid: Number(p.ppid) || 0,
          wsMb: Number(p.ws) || 0,
          privMb: Number(p.priv) || 0,
          cmd: p.cmd ? String(p.cmd) : null,
        }),
      ),
      listeners: (Array.isArray(j.listeners) ? j.listeners : j.listeners ? [j.listeners] : []).map(
        (l: { port?: unknown; addr?: unknown; pid?: unknown }) => ({
          port: Number(l.port) || 0,
          addr: String(l.addr ?? ""),
          pid: Number(l.pid) || 0,
        }),
      ),
      vmmemMb: j.vmmemMb ?? 0,
      wslText: typeof j.wsl === "string" ? j.wsl : "",
    };
  } catch {
    return null;
  }
}

export async function probeOllama(timeoutMs = 1_500): Promise<OllamaSnapshot> {
  const base = process.env.LITT_OLLAMA_URL ?? "http://127.0.0.1:11434";
  const snap: OllamaSnapshot = { reachable: false, version: null, loaded: [] };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const ps = await fetch(`${base}/api/ps`, { signal: ctl.signal });
      if (!ps.ok) return snap;
      snap.reachable = true;
      const body = (await ps.json()) as {
        models?: {
          name?: string;
          size?: number;
          details?: { quantization_level?: string };
          expires_at?: string;
        }[];
      };
      snap.loaded = (body.models ?? []).map((m) => ({
        name: m.name ?? "unknown",
        sizeGb: Math.round(((m.size ?? 0) / 1e9) * 10) / 10,
        processor: "",
        context: null,
        expiresAt: m.expires_at ?? null,
      }));
      // /api/ps doesn't expose processor split — query each model's show for
      // context only when the caller needs it. Keep this probe cheap.
    } finally {
      clearTimeout(t);
    }
    const v = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
    if (v?.ok) {
      const j = (await v.json()) as { version?: string };
      snap.version = j.version ?? null;
    }
  } catch {
    /* unreachable — snap stays empty */
  }
  return snap;
}

/** Processor split + context from `ollama ps` text (CLI knows both; API doesn't split CPU/GPU). */
export function probeOllamaPsCli(): { name: string; processor: string; context: number | null }[] {
  const r = exec("ollama ps", { timeout: 8_000 });
  if (r.exitCode !== 0 || !r.stdout) return [];
  const rows: { name: string; processor: string; context: number | null }[] = [];
  for (const line of r.stdout.split(/\r?\n/).slice(1)) {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 5) continue;
    const ctx = parseInt(cols[4] ?? "", 10);
    rows.push({
      name: cols[0] ?? "",
      processor: cols[3] ?? "",
      context: Number.isFinite(ctx) ? ctx : null,
    });
  }
  return rows;
}

export function probeTailscale(): TailscaleSnapshot {
  const snap: TailscaleSnapshot = { up: false, selfIp: null, peers: [] };
  const r = exec("tailscale status --json", { timeout: 8_000 });
  if (r.exitCode !== 0 || !r.stdout) return snap;
  try {
    const j = JSON.parse(r.stdout) as {
      BackendState?: string;
      Self?: { TailscaleIPs?: string[] };
      Peer?: Record<string, {
        HostName?: string;
        TailscaleIPs?: string[];
        OS?: string;
        Online?: boolean;
        Idle?: boolean;
      }>;
    };
    snap.up = j.BackendState === "Running";
    snap.selfIp = j.Self?.TailscaleIPs?.[0] ?? null;
    for (const p of Object.values(j.Peer ?? {})) {
      snap.peers.push({
        name: p.HostName ?? "?",
        ip: p.TailscaleIPs?.[0] ?? "?",
        os: p.OS ?? "",
        online: p.Online ?? false,
        idle: p.Idle ?? true,
      });
    }
  } catch {
    /* malformed json — degrade */
  }
  return snap;
}
