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
  /** Approval lifecycle audit fields (R3): the recorded decision and the
   *  settle event type — ids and outcomes only, never inputs. */
  decision?: string;
  eventType?: string;
  /** Workspace-verdict audit fields (R3): the verdict a computation
   *  produced and the baseline it was computed against. */
  verdict?: string;
  checkpointId?: string;
  fileCount?: number;
  kind?: string;
  /** Severity marker for lines that must stand out in stdout (e.g. the
   *  checkpoint-unavailable WARN). Absent = informational. */
  level?: string;
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
