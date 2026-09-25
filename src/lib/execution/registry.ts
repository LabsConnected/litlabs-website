import type { RouterStep, StepType } from "@/lib/intent-router/types";

export interface LiTTExecutor {
  type: StepType;
  execute(step: RouterStep, context: ExecutorContext): Promise<ExecutorResult>;
}

export interface ExecutorContext {
  planId: string;
  stepId: string;
  projectId?: string;
  attempt: number;
  signal: AbortSignal;
  resolveInput(name: string): unknown;
}

export interface ExecutorResult {
  outputs: import("@/lib/intent-router/types").ArtifactRef[];
  metadata?: Record<string, unknown>;
}

export class ExecutorRegistry {
  private readonly executors = new Map<StepType, LiTTExecutor>();

  register(executor: LiTTExecutor): this {
    if (this.executors.has(executor.type)) throw new Error(`Executor already registered: ${executor.type}`);
    this.executors.set(executor.type, executor);
    return this;
  }

  get(type: StepType): LiTTExecutor {
    const executor = this.executors.get(type);
    if (!executor) throw new Error(`No executor registered for StepType: ${type}`);
    return executor;
  }

  has(type: StepType): boolean {
    return this.executors.has(type);
  }

  assertComplete(types: readonly StepType[]): void {
    const missing = types.filter((type) => !this.executors.has(type));
    if (missing.length > 0) throw new Error(`Missing executors: ${missing.join(", ")}`);
  }

  list(): StepType[] {
    return [...this.executors.keys()];
  }
}

export function createExecutorRegistry(executors: LiTTExecutor[] = []): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  executors.forEach((executor) => registry.register(executor));
  return registry;
}
