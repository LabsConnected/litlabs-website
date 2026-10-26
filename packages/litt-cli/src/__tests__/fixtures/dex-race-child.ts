/**
 * Real-process fixture for dex race tests — spawned via tsx as an actual
 * OS process so the parent observes true cross-process contention inside
 * the REAL auth-token.ts / audit.ts modules, not a mock.
 *
 * Env:
 *   LITT_STATE_HOME              — required, isolates the dex home dir.
 *   LITT_DEX_TOKEN_CREATE_HOLD_MS — widens the exclusive-create window so
 *                                  a sibling process provably lands in
 *                                  the EEXIST path.
 *   LITT_DEX_AUDIT_LOCK_HOLD_MS   — widens the locked rotate+append
 *                                  critical section.
 *
 * Argv:
 *   [2] mode: "token" | "audit"
 *   [3] tag  — unique per child (record detail prefix)
 *   [4] outFile — this process writes its result here (never stdout:
 *              the token must not travel through process stdio)
 *   [5] iterations — audit mode record count (default 30)
 */
import { writeFileSync } from "node:fs";
import { loadOrCreateToken } from "../../lib/dex/auth-token.js";
import { audit } from "../../lib/dex/audit.js";

const mode = process.argv[2] ?? "token";
const tag = process.argv[3] ?? "child";
const outFile = process.argv[4];
const iterations = Number(process.argv[5] ?? 30);

if (mode === "token") {
  const token = loadOrCreateToken();
  if (outFile) writeFileSync(outFile, token, "utf8");
} else {
  // Small rotation caps force constant rotations so rotate+append races
  // surface inside the run rather than needing a 10 MB log.
  for (let i = 0; i < iterations; i++) {
    audit({ verb: "race", ok: true, ms: i, detail: `${tag}-${i}` }, { maxBytes: 512, maxBackups: 3 });
  }
  if (outFile) writeFileSync(outFile, "done", "utf8");
}
process.exit(0);
