export interface ExecutorTask {
  id: string;
  sessionId: string;
  input: {
    prompt: string;
    context?: Record<string, unknown>;
    provider?: "openrouter" | "bedrock";
    model?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ExecutorResult {
  taskId: string;
  status: "success" | "failed";
  text: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  model?: string;
  provider?: string;
  error?: string;
}

export interface LlmExecutor {
  run(task: ExecutorTask): Promise<ExecutorResult>;
}

export class OpenRouterExecutor implements LlmExecutor {
  async run(task: ExecutorTask): Promise<ExecutorResult> {
    try {
      const { complete } = await import("@/lib/llm-completion");
      const completion = await complete({
        provider: "openrouter",
        model: task.input.model || "openrouter/gpt-4o-mini",
        prompt: task.input.prompt,
        maxTokens: 512,
        temperature: 0.2,
      });

      return {
        taskId: task.id,
        status: "success",
        text: completion.text,
        usage: completion.usage,
        model: task.input.model,
        provider: "openrouter",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Executor failed";
      return {
        taskId: task.id,
        status: "failed",
        text: "",
        model: task.input.model,
        provider: "openrouter",
        error: message,
      };
    }
  }
}
