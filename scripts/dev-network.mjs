#!/usr/bin/env node
/**
 * Safe-default wrapper around `next dev`.
 *
 * `next dev` has no localhost-only default of its own — invoked bare it
 * listens on every interface. This wrapper resolves the correct bind host
 * (see ./resolve-dev-host.mjs for the precedence: Railway > --tailscale >
 * --lan > HOST env > 127.0.0.1 default) and re-execs `next dev` with an
 * explicit `-H <host>`, so plain `pnpm dev` is localhost-only by default
 * and LAN/tailnet exposure requires an explicit flag.
 *
 * Usage (via package.json "dev" / "dev:webpack" scripts):
 *   pnpm dev                 -> next dev ... -H 127.0.0.1
 *   pnpm dev --lan           -> next dev ... -H 0.0.0.0
 *   pnpm dev --tailscale     -> next dev ... -H <tailnet IP>, or fails
 *                                clearly if no Tailscale interface exists
 *
 * --lan and --tailscale are consumed here and never forwarded to `next`
 * (which doesn't understand them); every other argument passes through
 * unchanged.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolveBindHost, stripNetworkFlags } from "./resolve-dev-host.mjs";

const forwardedArgs = stripNetworkFlags(process.argv.slice(2));

let bind;
try {
  bind = resolveBindHost();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log(`[dev-network] binding Next.js dev server to ${bind.host} (${bind.reason})`);

// Resolve `next`'s actual CLI entry and invoke it directly with the same
// node binary running this script, rather than relying on `next` being on
// PATH via a shell — this works regardless of how this script itself was
// invoked (bare `node scripts/dev-network.mjs`, not just `pnpm dev`), and
// avoids Node's shell:true + argv-array deprecation warning.
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next", { paths: [process.cwd()] });

const child = spawn(process.execPath, [nextBin, "dev", ...forwardedArgs, "-H", bind.host], {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});

child.on("error", (err) => {
  console.error("[dev-network] failed to start next dev:", err.message);
  process.exit(1);
});
