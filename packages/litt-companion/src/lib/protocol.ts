export type LiTTEventBase = {
  version: 1;
  eventId: string;
  timestamp: string;
  userId: string;
  conversationId: string;
  projectId?: string;
  runId?: string;
  sequence?: number;
};

export type LiTTMobileEvent =
  | (LiTTEventBase & { type: "message.delta"; messageId: string; content: string })
  | (LiTTEventBase & { type: "message.completed"; messageId: string; content: string })
  | (LiTTEventBase & { type: "run.started"; title: string })
  | (LiTTEventBase & { type: "run.progress"; progress: number; step: string })
  | (LiTTEventBase & { type: "tool.started"; toolCallId: string; toolName: string; args?: Record<string, unknown> })
  | (LiTTEventBase & { type: "tool.completed"; toolCallId: string; toolName: string; success: boolean; result?: unknown })
  | (LiTTEventBase & { type: "approval.required"; approvalId: string; action: string; metadata?: Record<string, unknown> })
  | (LiTTEventBase & { type: "verification.completed"; verified: boolean; receiptId: string; summary?: string })
  | (LiTTEventBase & { type: "preview.ready"; url: string })
  | (LiTTEventBase & { type: "run.failed"; error: string; recoverable: boolean })
  | (LiTTEventBase & { type: "run.completed"; summary: string });

export interface ExecutionReceipt {
  receiptId: string;
  runId?: string;
  filesModified: number;
  typecheckPassed: boolean;
  buildPassed: boolean;
  previewUrl?: string;
  timestamp: string;
}

export interface ActiveRunState {
  runId?: string;
  title: string;
  status: "idle" | "running" | "waiting_approval" | "completed" | "failed";
  progress: number;
  currentStep: string;
  modifiedFilesCount: number;
  typecheckPassed: boolean;
  buildPassed: boolean;
  previewUrl?: string;
  error?: string;
  toolsExecuting: Array<{ toolCallId: string; name: string; status: "running" | "done" | "failed" }>;
  receipt?: ExecutionReceipt;
}

export const initialRunState: ActiveRunState = {
  title: "",
  status: "idle",
  progress: 0,
  currentStep: "",
  modifiedFilesCount: 0,
  typecheckPassed: false,
  buildPassed: false,
  toolsExecuting: [],
};

export function reduceLiTTEvent(state: ActiveRunState, event: LiTTMobileEvent): ActiveRunState {
  switch (event.type) {
    case "run.started":
      return {
        ...initialRunState,
        runId: event.runId,
        title: event.title,
        status: "running",
        progress: 10,
        currentStep: "Started run...",
      };
    case "run.progress":
      return {
        ...state,
        progress: event.progress,
        currentStep: event.step,
      };
    case "tool.started":
      return {
        ...state,
        currentStep: `Running ${event.toolName}...`,
        toolsExecuting: [
          ...state.toolsExecuting.filter((t) => t.toolCallId !== event.toolCallId),
          { toolCallId: event.toolCallId, name: event.toolName, status: "running" },
        ],
      };
    case "tool.completed":
      return {
        ...state,
        toolsExecuting: state.toolsExecuting.map((t) =>
          t.toolCallId === event.toolCallId
            ? { ...t, status: event.success ? "done" : "failed" }
            : t
        ),
      };
    case "approval.required":
      return {
        ...state,
        status: "waiting_approval",
        currentStep: `Approval needed: ${event.action}`,
      };
    case "verification.completed":
      return {
        ...state,
        typecheckPassed: event.verified,
        buildPassed: event.verified,
        receipt: {
          receiptId: event.receiptId,
          runId: event.runId,
          filesModified: state.modifiedFilesCount,
          typecheckPassed: event.verified,
          buildPassed: event.verified,
          previewUrl: state.previewUrl,
          timestamp: event.timestamp,
        },
      };
    case "preview.ready":
      return {
        ...state,
        previewUrl: event.url,
      };
    case "run.failed":
      return {
        ...state,
        status: "failed",
        error: event.error,
        currentStep: `Run failed: ${event.error}`,
      };
    case "run.completed":
      return {
        ...state,
        status: "completed",
        progress: 100,
        currentStep: "Run completed successfully.",
      };
    default:
      return state;
  }
}
