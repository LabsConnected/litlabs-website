import { adapters } from "./adapters.js";
import { loadState, saveState } from "./store.js";
import { stepStateSchema, type Mission, type MissionState, type MissionStep } from "./contracts.js";

// Mission runner — the DETECT→EXECUTE→VERIFY→CHECKPOINT loop.
//
// Idempotency contract: before executing a step, its adapter probe()
// checks whether the desired end-state already exists. On resume, an
// "in-flight" step is probed first — if the action landed before the
// crash, the step completes WITHOUT re-execution (no duplicate
// dispatches, deploys, or writes).
//
// Exit semantics mirror litt repair:
//   0 complete · 1 failed/blocked · 3 parked (owner action required)

export interface RunResult {
  exitCode: 0 | 1 | 3;
  state: MissionState;
}

function depsDone(mission: Mission, state: MissionState, step: MissionStep): boolean {
  return step.dependsOn.every((d) => state.steps[d]?.status === "done" || state.steps[d]?.status === "skipped");
}

function log(state: MissionState, line: string): void {
  const entry = `${new Date().toISOString()} ${line}`;
  state.log.push(entry);
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
}

export async function runMission(workspace: string, mission: Mission): Promise<RunResult> {
  const state = loadState(workspace, mission.id);
  const deadline = Date.now() + mission.budgetMs;

  if (state.status === "complete") return { exitCode: 0, state };
  if (state.status !== "parked") state.status = "running";
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  for (const s of mission.steps) {
    state.steps[s.id] ??= stepStateSchema.parse({});
  }

  const flush = () => saveState(workspace, state);
  flush();

  let madeProgress = true;
  while (madeProgress && Date.now() < deadline) {
    madeProgress = false;
    for (const step of mission.steps) {
      const ss = state.steps[step.id]!;
      if (ss.status === "done" || ss.status === "skipped" || ss.status === "blocked" || ss.status === "parked") continue;
      if (!depsDone(mission, state, step)) continue;

      const adapter = adapters[step.kind];
      if (!adapter) {
        ss.status = "blocked";
        ss.evidence.push(`no adapter for kind ${step.kind}`);
        log(state, `BLOCKED ${step.id}: no adapter`);
        madeProgress = true;
        continue;
      }

      // Idempotent re-entry: probe before any execution.
      const probe = await adapter.probe(step).catch((e) => ({ ok: false, evidence: [`probe error: ${(e as Error).message}`] }));
      if (probe.ok) {
        ss.status = "done";
        ss.evidence.push(...probe.evidence, "(end-state already present — no re-execution)");
        ss.updatedAt = new Date().toISOString();
        log(state, `DONE ${step.id} (idempotent): ${probe.evidence[0] ?? ""}`);
        madeProgress = true;
        flush();
        continue;
      }

      if (step.kind === "owner-gate") {
        ss.status = "parked";
        ss.evidence.push(step.description);
        state.status = "parked";
        log(state, `PARKED ${step.id}: ${step.description}`);
        flush();
        return { exitCode: 3, state };
      }

      if (ss.attempts >= step.maxAttempts) {
        ss.status = "blocked";
        ss.evidence.push(`exhausted ${step.maxAttempts} attempts`);
        log(state, `BLOCKED ${step.id}: retry limit reached`);
        madeProgress = true;
        flush();
        continue;
      }

      ss.status = "in-flight";
      ss.attempts += 1;
      ss.updatedAt = new Date().toISOString();
      log(state, `RUN ${step.id} attempt ${ss.attempts}/${step.maxAttempts}: ${step.description}`);
      flush(); // checkpoint BEFORE the action — crash here resumes by probing

      const stepDeadline = Math.min(deadline, Date.now() + step.timeoutMs);
      const result = await adapter.run(step, stepDeadline).catch((e) => ({ ok: false, evidence: [`adapter error: ${(e as Error).message}`] }));

      if (result.ok) {
        ss.status = "done";
        ss.evidence.push(...result.evidence);
        log(state, `DONE ${step.id}: ${result.evidence[0] ?? "ok"}`);
      } else {
        ss.status = "pending"; // re-attemptable until maxAttempts
        ss.evidence.push(`attempt ${ss.attempts} failed: ${result.evidence.join(" | ").slice(0, 500)}`);
        log(state, `FAIL ${step.id} attempt ${ss.attempts}: ${result.evidence[0] ?? ""}`);
        if (ss.attempts >= step.maxAttempts) {
          ss.status = "blocked";
          ss.evidence.push(`blocked: max attempts (${step.maxAttempts}) reached — escalating`);
          log(state, `BLOCKED ${step.id}: max attempts reached — escalating`);
        }
      }
      ss.updatedAt = new Date().toISOString();
      madeProgress = true;
      flush();
    }
  }

  const parkedSteps = mission.steps.filter((s) => state.steps[s.id]!.status === "parked");
  const blocked = mission.steps.filter((s) => state.steps[s.id]!.status === "blocked");
  const incomplete = mission.steps.filter((s) => !["done", "skipped", "blocked", "parked"].includes(state.steps[s.id]!.status));

  if (parkedSteps.length > 0 && blocked.length === 0) {
    state.status = "parked";
    flush();
    return { exitCode: 3, state };
  }

  if (blocked.length > 0 || incomplete.length > 0) {
    state.status = "blocked";
    if (Date.now() >= deadline) log(state, "mission budget exhausted");
    flush();
    return { exitCode: 1, state };
  }

  state.status = "complete";
  state.completedAt = new Date().toISOString();
  log(state, "MISSION COMPLETE");
  flush();
  return { exitCode: 0, state };
}
