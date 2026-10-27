/**
 * Regression tests — `--mode plan` propagation into the cockpit.
 *
 * Guards the fix for the launch-mode bypass: dispatch.ts extracted
 * --mode correctly but cockpitCommand hardcoded `mode: "act"` in its
 * RuntimeSession, so `litt --mode plan` silently ran as ACT.
 *
 *   1. resolveDispatch extracts --mode for every supported cockpit
 *      launch form (bare litt, cockpit, shell, tui, with --cwd).
 *   2. cockpitRuntimeSessionOptions threads the dispatch mode into the
 *      RuntimeSession options — the exact seam cockpit.ts uses.
 *   3. A session built that way reports getMode() === "plan" — the
 *      value every enforcement point reads.
 *   4. PLAN rejects a mutating tool at the ExecutionGateway with no
 *      filesystem write and no approval callback.
 *   5. Explicit --mode act still initializes ACT.
 *   6. No context at all keeps the ACT default (unchanged behavior).
 *
 * Uses the real RuntimeSession + ExecutionGateway against a scratch dir.
 * Marker files prove whether a mutation happened.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDispatch } from "../lib/dispatch.js";
import { cockpitRuntimeSessionOptions } from "../commands/cockpit.js";
import { createRuntimeSession } from "../lib/runtime-session.js";

const SCRATCH = join(tmpdir(), "litt-cockpit-mode-scratch");

function makeSession(mode: "plan" | "act" | "auto" | undefined) {
  return createRuntimeSession(
    cockpitRuntimeSessionOptions(SCRATCH, mode ? { mode } : undefined, {
      onApprovalRequired: async () => {
        throw new Error("approval must not be consulted in this test");
      },
    }),
  );
}

describe("--mode → cockpit propagation", () => {
  beforeEach(() => {
    if (!existsSync(SCRATCH)) mkdirSync(SCRATCH, { recursive: true });
  });

  afterEach(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  describe("dispatch extraction — supported launch forms", () => {
    it("bare `litt --mode plan` → cockpit surface with plan", () => {
      const d = resolveDispatch(["--mode", "plan"]);
      expect(d.command).toBe("cockpit");
      expect(d.mode).toBe("plan");
    });

    it("`litt cockpit --mode plan` → plan", () => {
      const d = resolveDispatch(["cockpit", "--mode", "plan"]);
      expect(d.command).toBe("cockpit");
      expect(d.mode).toBe("plan");
    });

    it("`litt shell --mode plan` → plan", () => {
      const d = resolveDispatch(["shell", "--mode", "plan"]);
      expect(d.mode).toBe("plan");
    });

    it("`litt tui --mode plan` → plan", () => {
      const d = resolveDispatch(["tui", "--mode", "plan"]);
      expect(d.mode).toBe("plan");
    });

    it("`litt --mode plan --cwd <dir>` → plan with the explicit cwd", () => {
      const d = resolveDispatch(["--mode", "plan", "--cwd", SCRATCH]);
      expect(d.command).toBe("cockpit");
      expect(d.mode).toBe("plan");
      expect(d.cwd).toBe(SCRATCH);
    });

    it("`litt shell --window --mode plan` → plan survives to --window rest", () => {
      const d = resolveDispatch(["shell", "--window", "--mode", "plan"]);
      expect(d.mode).toBe("plan");
      expect(d.rest).toContain("--window");
    });
  });

  describe("session options seam (what cockpit.ts actually builds)", () => {
    it("context mode plan → session options carry plan", () => {
      const opts = cockpitRuntimeSessionOptions(SCRATCH, { mode: "plan" }, {});
      expect(opts.mode).toBe("plan");
      expect(opts.cwd).toBe(SCRATCH);
    });

    it("context mode act → session options carry act", () => {
      const opts = cockpitRuntimeSessionOptions(SCRATCH, { mode: "act" }, {});
      expect(opts.mode).toBe("act");
    });

    it("context mode auto → session options carry auto", () => {
      const opts = cockpitRuntimeSessionOptions(SCRATCH, { mode: "auto" }, {});
      expect(opts.mode).toBe("auto");
    });

    it("no context → act fallback (existing default unchanged)", () => {
      const opts = cockpitRuntimeSessionOptions(SCRATCH, undefined, {});
      expect(opts.mode).toBe("act");
    });
  });

  describe("runtime permission state", () => {
    it("plan launch → session.getMode() is plan", () => {
      expect(makeSession("plan").getMode()).toBe("plan");
    });

    it("act launch → session.getMode() is act", () => {
      expect(makeSession("act").getMode()).toBe("act");
    });

    it("plan session → gateway rejects a mutating tool with no write", async () => {
      const session = makeSession("plan");
      const marker = join(SCRATCH, "must-not-exist.txt");
      const result = await session.getGateway().execute({
        toolId: "project.write_file",
        inputs: { path: marker, content: "x" },
        cwd: SCRATCH,
        mode: session.getMode(),
        identity: {
          tenantId: "cli-tenant",
          userId: "cli-user",
          actorId: "cli-user",
          trusted: false,
          interaction: "interactive",
        },
      });
      expect(result.result.success).toBe(false);
      expect(existsSync(marker)).toBe(false);
    });
  });
});
