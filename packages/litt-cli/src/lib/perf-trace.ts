/**
 * PerfTrace — lightweight latency instrumentation for the LiTT operator loop.
 *
 * Enabled ONLY when `LITT_PERF=1` is set. Otherwise every method is a
 * no-op and `enabled` is false, so there is zero overhead in normal use.
 *
 * Usage (controller):
 *   const perf = PerfTrace.start(intent);
 *   perf.mark("intent_classified");
 *   perf.mark("context_resolved");
 *   ... mission setup ...
 *   perf.mark("branch_refreshed");
 *   perf.mark("mission_initialized");
 *   perf.mark("mission_created");
 *   perf.mark("route");
 *   perf.mark("provider_ready");   // adapter resolved, NOT an outbound request
 *   perf.mark("plan_start");
 *   ... planMission() ...
 *   perf.mark("plan_end");
 *   perf.mark("agent_loop_start"); // first outbound request fires inside here
 *   perf.mark("first_token");      // first VISIBLE model prose (after tool-call filter)
 *   perf.mark("tool_start:project.diff");
 *   perf.mark("tool_end:project.diff");
 *   perf.mark("finalize");
 *   perf.end("mission");           // prints the report to stderr
 *
 * Label truthfulness: `provider_ready` marks the adapter being ready, not
 * an outbound request — the actual request fires inside the agent loop, so
 * we do not claim provider latency at the `provider_ready` boundary.
 *
 * The report is a flat, ordered list of marks with deltas from the
 * previous mark and from start — exactly the shape described in the
 * perf pass plan:
 *
 *   LiTT PERF  (mission · 4120ms)
 *     submit → intent_classified   12ms
 *     intent_classified → context_resolved   8ms
 *     context_resolved → branch_refreshed   5ms
 *     ...
 *     provider_ready → plan_start   3ms
 *     plan_start → plan_end   420ms
 *     plan_end → agent_loop_start   2ms
 *     agent_loop_start → first_token   1840ms
 *     ...
 *
 * Marks are de-duplicated by label (first occurrence wins) so a label
 * emitted many times (e.g. "first_token" guarded by a flag) records the
 * earliest timestamp — the truthful time-to-first-token.
 */

export class PerfTrace {
  readonly enabled: boolean;
  private readonly intent: string;
  private readonly t0: number;
  private marks: { label: string; ts: number }[] = [];
  private ended = false;

  private constructor(intent: string, enabled: boolean) {
    this.intent = intent;
    this.enabled = enabled;
    this.t0 = Date.now();
    if (enabled) this.marks.push({ label: "submit", ts: this.t0 });
  }

  /** Create a trace. No-op unless LITT_PERF=1. */
  static start(intent: string): PerfTrace {
    const enabled = process.env.LITT_PERF === "1" || process.env.LITT_PERF === "true";
    return new PerfTrace(intent, enabled);
  }

  /** Record a phase boundary. First occurrence of a label wins. */
  mark(label: string): void {
    if (!this.enabled) return;
    if (this.marks.some((m) => m.label === label)) return;
    this.marks.push({ label, ts: Date.now() });
  }

  /** Print the report and freeze. Safe to call once (idempotent).
   *
   * `kind` is the run class: "chat" / "mission" for model-backed turns,
   * "local" for the deterministic Local Fast Lane (no model/provider). */
  end(kind: "chat" | "mission" | "local" | "read"): void {
    if (!this.enabled || this.ended) return;
    this.ended = true;
    const total = Date.now() - this.t0;
    const lines: string[] = [];
    lines.push(`LiTT PERF  (${kind} · ${this.intent} · ${total}ms)`);
    for (let i = 1; i < this.marks.length; i++) {
      const prev = this.marks[i - 1];
      const cur = this.marks[i];
      const delta = cur.ts - prev.ts;
      lines.push(`  ${prev.label.padEnd(22)} → ${cur.label.padEnd(18)} ${String(delta).padStart(6)}ms`);
    }
    // Cumulative from submit for the final mark, if any.
    if (this.marks.length > 1) {
      const last = this.marks[this.marks.length - 1];
      lines.push(`  ${"submit".padEnd(22)} → ${last.label.padEnd(18)} ${String(last.ts - this.t0).padStart(6)}ms  (total to last mark)`);
    }
    process.stderr.write(lines.join("\n") + "\n");
  }
}
