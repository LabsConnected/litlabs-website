export interface LogContext {
  requestId?: string;
  clientRequestId?: string;
  conversationId?: string;
  projectId?: string;
  userId?: string;
  agentSlug?: string;
  agentInstanceId?: string | null;
  provider?: string;
  latencyMs?: number;
  status?: string;
  revisionBefore?: number;
  revisionAfter?: number;
  memoryProvider?: string;
  fallbackUsed?: boolean;
  errorClass?: string;
}

export function studioLog(message: string, ctx: LogContext = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    ...ctx,
  };
  // Use console.error for structured logs (avoids Next.js request noise filtering)
  console.error(JSON.stringify(entry));
}
