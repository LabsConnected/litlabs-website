import { randomUUID } from "node:crypto";
import type {
  ExecutionPlan,
  ExecutionState,
  ExecutionError,
  RouterStep,
  StepExecutionState,
} from "@/lib/intent-router/types";
import { validatePlan } from "@/lib/planner/planner";
import type { ExecutorContext, ExecutorRegistry } from "./registry";

export interface ExecutionStore {
  load(planId: string): Promise<ExecutionState | null>;
  save(state: ExecutionState): Promise<void>;
}

export class MemoryExecutionStore implements ExecutionStore {
  private readonly states = new Map<string, ExecutionState>();

  async load(planId: string): Promise<ExecutionState | null> {
    const state = this.states.get(planId);
    return state ? structuredClone(state) : null;
  }

  async save(state: ExecutionState): Promise<void> {
    this.states.set(state.planId, structuredClone(state));
  }
}

export interface ExecutionEngineOptions {
  plan: ExecutionPlan;
  registry: ExecutorRegistry;
  store: ExecutionStore;
  projectId?: string;
  isApproved?: (step: RouterStep) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  runId: string;
  state: ExecutionState;
}

const now = () => new Date().toISOString();

function errorFrom(error: unknown, code = "EXECUTION_FAILED"): ExecutionError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: code === "TIMEOUT" || code === "LEASE_EXPIRED",
  };
}

function terminal(status: StepExecutionState["status"]): boolean {
  return ["complete", "failed", "cancelled", "skipped"].includes(status);
}

function dependenciesSucceeded(step: RouterStep, state: ExecutionState): boolean {
  return step.dependsOn.every((key) => state.steps[key]?.status === "complete");
}

function dependenciesFailed(step: RouterStep, state: ExecutionState): boolean {
  return step.dependsOn.some((key) => ["failed", "cancelled", "stalled"].includes(state.steps[key]?.status ?? ""));
}

function runnableSteps(plan: ExecutionPlan, state: ExecutionState): RouterStep[] {
  return plan.steps.filter((step) => {
    const current = state.steps[step.key];
    if (!current || terminal(current.status) || current.status === "waiting_approval") return false;
    if (dependenciesFailed(step, state)) return false;
    return step.condition?.type === "always" || dependenciesSucceeded(step, state);
  });
}

function initialState(plan: ExecutionPlan): ExecutionState {
  return {
    planId: plan.id,
    status: "queued",
    updatedAt: now(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    steps: Object.fromEntries(
      plan.steps.map((step) => [step.key, { stepId: step.id, status: "queued", attempt: 0 }]),
    ),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error("Execution cancelled");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(Object.assign(new Error("Step timed out"), { code: "TIMEOUT" })), timeoutMs);
  });
  const abortPromise = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Execution cancelled")), { once: true });
  });
  try {
    return await Promise.race([promise, timeoutPromise, abortPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function executeStep(
  plan: ExecutionPlan,
  step: RouterStep,
  state: ExecutionState,
  options: ExecutionEngineOptions,
): Promise<void> {
  const current = state.steps[step.key];
  if (!current) return;
  const approved = step.approval === "none" || (await options.isApproved?.(step));
  if (!approved) {
    current.status = "waiting_approval";
    state.status = "waiting_approval";
    state.updatedAt = now();
    return;
  }

  current.status = "running";
  current.attempt += 1;
  current.startedAt = now();
  current.heartbeatAt = now();
  state.status = "running";
  state.updatedAt = now();
  await options.store.save(state);

  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason ?? new Error("Execution cancelled"));
  options.signal?.addEventListener("abort", abort, { once: true });
  const heartbeatMs = step.executionPolicy.heartbeatMs ?? 10_000;
  const leaseTimeoutMs = step.executionPolicy.leaseTimeoutMs ?? heartbeatMs * 4;
  const heartbeat = setInterval(() => {
    current.heartbeatAt = now();
    state.updatedAt = now();
    state.leaseExpiresAt = new Date(Date.now() + leaseTimeoutMs).toISOString();
    void options.store.save(state);
  }, heartbeatMs);

  try {
    const executor = options.registry.get(step.type);
    const resolveInput = (name: string) => {
      const binding = step.inputs[name];
      if (!binding || binding.source === "literal") return binding?.value;
      return state.steps[binding.stepKey]?.outputs?.find((output) => output.kind === binding.output);
    };
    const context: ExecutorContext = {
      planId: plan.id,
      stepId: step.id,
      projectId: options.projectId,
      attempt: current.attempt,
      signal: controller.signal,
      resolveInput,
    };
    const result = await withTimeout(executor.execute(step, context), step.executionPolicy.timeoutMs, controller.signal);
    const lastHeartbeat = current.heartbeatAt ? Date.parse(current.heartbeatAt) : Date.now();
    if (Date.now() - lastHeartbeat > leaseTimeoutMs) throw Object.assign(new Error("Step lease expired"), { code: "LEASE_EXPIRED" });
    current.status = "complete";
    current.completedAt = now();
    current.outputs = result.outputs;
    current.error = undefined;
  } catch (error) {
    const executionError = errorFrom(error, (error as { code?: string })?.code ?? "EXECUTION_FAILED");
    current.error = executionError;
    if (options.signal?.aborted) current.status = "cancelled";
    else if (current.attempt < step.executionPolicy.maxAttempts && step.retryable && executionError.retryable !== false) current.status = "queued";
    else current.status = executionError.code === "LEASE_EXPIRED" ? "failed" : "failed";
  } finally {
    clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", abort);
    state.updatedAt = now();
    await options.store.save(state);
  }
}

export async function executePlan(options: ExecutionEngineOptions): Promise<ExecutionResult> {
  validatePlan(options.plan);
  const state = (await options.store.load(options.plan.id)) ?? initialState(options.plan);
  const runId = state.planId || randomUUID();
  if (
    state.leaseExpiresAt &&
    Date.parse(state.leaseExpiresAt) < Date.now() &&
    ["preparing", "running", "waiting_approval"].includes(state.status)
  ) {
    state.status = "stalled";
    state.error = { code: "LEASE_EXPIRED", message: "Execution lease expired; retry or resolve the run.", retryable: true };
    state.updatedAt = now();
    await options.store.save(state);
    return { runId, state };
  }
  state.status = "preparing";
  state.updatedAt = now();
  state.leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  await options.store.save(state);

  while (true) {
    if (options.signal?.aborted) {
      state.status = "cancelled";
      state.error = errorFrom(options.signal.reason, "CANCELLED");
      await options.store.save(state);
      return { runId, state };
    }
    const pending = options.plan.steps.filter((step) => !terminal(state.steps[step.key]?.status ?? "queued"));
    if (pending.length === 0) break;
    const runnable = runnableSteps(options.plan, state);
    if (runnable.length === 0) {
      if (Object.values(state.steps).some((step) => step.status === "waiting_approval")) state.status = "waiting_approval";
      else if (Object.values(state.steps).some((step) => step.status === "failed")) state.status = "failed";
      else state.status = "stalled";
      state.updatedAt = now();
      await options.store.save(state);
      return { runId, state };
    }
    await Promise.all(runnable.map((step) => executeStep(options.plan, step, state, options)));
  }

  state.status = Object.values(state.steps).some((step) => step.status === "failed") ? "failed" : "complete";
  state.updatedAt = now();
  await options.store.save(state);
  return { runId, state };
}
