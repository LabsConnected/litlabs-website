export interface LogContext {
  requestId?: string;
  clientRequestId?: string;
  conversationId?: string;
  projectId?: string;
  actionRunId?: string;
  actionRunCancellation?: "not_applicable" | "requested" | "failed";
  userId?: string;
  agentSlug?: string;
  agentInstanceId?: string | null;
  provider?: string;
  model?: string;
  latencyMs?: number;
  status?: string;
  revisionBefore?: number;
  revisionAfter?: number;
  memoryProvider?: string;
  fallbackUsed?: boolean;
  errorClass?: string;
  intent?: string;
  confidence?: number;
  tool?: string;
  v2?: boolean;
  stepsUsed?: number;
  toolCalls?: number;
  pausedRunId?: string;
  finishReason?: string;
  failover?: string[];
  claimLost?: boolean;
  alreadyTerminal?: boolean;
  /** Approval-gate forensics: which durable event produced a handoff. */
  gateId?: string;
  /** Paused-run outcome forensics: the action run's recorded status and the claim row's error when they diverge. */
  actionRunStatus?: string;
  claimError?: string;
  nestedPausedRunId?: string;
  eventId?: string;
  eventSequence?: string;
  eventSource?: "settle" | "action_events" | "progress" | "messages_route";
  hasPausedRunId?: boolean;
  hasToolId?: boolean;
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
