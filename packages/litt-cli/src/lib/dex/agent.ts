/**
 * Dex agent supervisor — `litt dex serve` foreground process.
 *
 * Lifecycle: clear stale sentinel → mint/load token → bind 127.0.0.1 →
 * serve until STOP sentinel (checked per-request AND every 500ms) or
 * SIGTERM/SIGINT. Prints the bound URL + token location once; the token
 * itself is never printed. Writes heartbeat (RSS/CPU) to the audit log
 * every 60s so real resource numbers are on record.
 */

import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditSoon, flushAuditQueue } from "./audit.js";
import { dexHome } from "./dex-home.js";
import { loadOrCreateToken } from "./auth-token.js";
import { clearStop, isStopRequested } from "./kill-switch.js";
import { createDexListener } from "./http-listener.js";

const SENTINEL_POLL_MS = 500;
const HEARTBEAT_MS = 60_000;

export interface DexAgent {
  url: string;
  port: number;
  stop: () => Promise<void>;
  ready: Promise<void>;
}

export async function startDexAgent(requestedPort = 0): Promise<DexAgent> {
  clearStop(); // explicit fresh start — a stale STOP is retired now
  const token = loadOrCreateToken();
  let halted = false;
  let haltResolve: (() => void) | null = null;

  const listener = createDexListener(token, 0, () => {
    if (!halted) {
      halted = true;
      haltResolve?.();
    }
  });

  await new Promise<void>((resolve, reject) => {
    listener.server.once("error", reject);
    // 127.0.0.1 literal — never 0.0.0.0, never a hostname.
    listener.server.listen(requestedPort, "127.0.0.1", resolve);
  });
  const port = (listener.server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  // Record where a local client finds the agent — port only, never token.
  writeFileSync(
    join(dexHome(), "agent.json"),
    JSON.stringify({ url, port, pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
  );

  const stop = () =>
    new Promise<void>((resolve) => {
      clearInterval(sentinelTimer);
      clearInterval(heartbeat);
      // Flush pending audit records best-effort — try-lock only, never
      // blocks: the emergency stop must not wait on a peer's lock.
      flushAuditQueue();
      // Force-close keep-alive/stalled connections — close() alone waits
      // for them to drain, which would let a wedged request stall the
      // emergency stop itself.
      (listener.server as { closeAllConnections?: () => void }).closeAllConnections?.();
      listener.server.close(() => resolve());
    });

  const sentinelTimer = setInterval(() => {
    if (isStopRequested()) {
      auditSoon({ verb: "agent", ok: true, ms: 0, detail: "stop sentinel observed — halting" });
      void stop().then(() => {
        halted = true;
        haltResolve?.();
      });
    }
  }, SENTINEL_POLL_MS);
  sentinelTimer.unref();

  const heartbeat = setInterval(() => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    auditSoon({
      verb: "agent.heartbeat",
      ok: true,
      ms: 0,
      detail: `rssMb=${Math.round(mem.rss / 1024 / 1024)} cpuUs=${cpu.user + cpu.system}`,
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  auditSoon({ verb: "agent.start", ok: true, ms: 0, detail: `${url} pid=${process.pid}` });

  return {
    url,
    port,
    stop,
    ready: new Promise<void>((resolve) => {
      haltResolve = resolve;
    }),
  };
}
