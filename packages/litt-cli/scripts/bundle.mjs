/**
 * Bundle the CLI entry into a single-file ESM graph under dist/.
 *
 * Why: `next dev`-style per-file output is fine for correctness but a
 * bare `litt` launch pays hundreds of module resolutions before the
 * cockpit can paint. Bundling collapses the graph — including Ink/React —
 * into a handful of chunks so warm launches hit the <1s interactivity
 * target.
 *
 * `tsc` still runs first (typechecking + .d.ts emission); this script
 * then rewrites dist/index.js and emits code-split chunks for the lazy
 * command/cockpit imports. Externals must stay out of the bundle:
 *   - @napi-rs/keyring — native .node addon
 *   - yoga-layout      — WASM loader, resolves its own .wasm file
 *   - node:*           — builtins (esbuild handles via platform:node)
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  absWorkingDir: pkgRoot,
  entryPoints: ["src/index.ts"],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outdir: "dist",
  keepNames: true,
  sourcemap: false,
  // Bundled CJS modules (e.g. @litt/agent-core) call require() — provide
  // one backed by the real module system. ESM chunks get the same banner;
  // a leading shebang in the output would be pushed below this import.
  banner: {
    js: 'import { createRequire as __littCreateRequire } from "node:module"; const require = __littCreateRequire(import.meta.url);',
  },
  external: [
    "@napi-rs/keyring",
    "yoga-layout",
    // WebSocket impls picked dynamically by ws/socket.io — keep external
    // so their native-optional fallbacks keep working.
    "bufferutil",
    "utf-8-validate",
  ],
});

// Stale-build guard: record the sha256 of the bundled entry so
// checkStaleBuild() can prove dist/index.js is still the bundled output.
// A later `pnpm dev` / `tsc` run rewrites dist/index.js unbundled — the
// hash stops matching and the build correctly reports stale instead of
// silently running the slower per-file graph as if it were current.
const entryHash = createHash("sha256")
  .update(readFileSync(resolve(pkgRoot, "dist/index.js")))
  .digest("hex");
writeFileSync(resolve(pkgRoot, "dist/.bundled"), `${entryHash}\n`, "utf8");

console.log("[bundle] dist/index.js rewritten as bundled entry");
