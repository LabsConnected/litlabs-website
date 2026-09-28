import { describe, expect, it, vi } from "vitest";
import {
  classifyFile,
  formatFileSize,
  validateFile,
} from "@/lib/litt-client/attachment-types";
import {
  classifyFile as studioClassifyFile,
  formatFileSize as studioFormatFileSize,
  validateFile as studioValidateFile,
} from "@/app/(app)/studio/lib/attachment-types";
import {
  submitApprovalAndPoll,
  watchApprovalResolution,
} from "@/lib/litt-client/approval-polling";
import {
  submitApprovalAndPoll as studioSubmitApprovalAndPoll,
  watchApprovalResolution as studioWatchApprovalResolution,
} from "@/app/(app)/studio/lib/approval-polling";
import {
  reconciledAssistantStatus,
  reconcileRunState,
} from "@/lib/litt-client/reconcile-run";
import {
  reconciledAssistantStatus as studioReconciledAssistantStatus,
  reconcileRunState as studioReconcileRunState,
} from "@/app/(app)/studio/lib/reconcile-run";
import { littConversationPaths } from "./endpoints";

describe("Studio re-exports the shared client modules", () => {
  it("keeps the same function identities Studio already imports", () => {
    expect(studioSubmitApprovalAndPoll).toBe(submitApprovalAndPoll);
    expect(studioWatchApprovalResolution).toBe(watchApprovalResolution);
    expect(studioReconcileRunState).toBe(reconcileRunState);
    expect(studioReconciledAssistantStatus).toBe(reconciledAssistantStatus);
    expect(studioClassifyFile).toBe(classifyFile);
    expect(studioValidateFile).toBe(validateFile);
    expect(studioFormatFileSize).toBe(formatFileSize);
  });

  it("posts an approval to the same path and body Studio's poller uses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "rejected" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

    const cancel = studioSubmitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "pause-9",
      decision: "rejected",
      fetchImpl,
      sleep: () => Promise.resolve(),
    });

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    cancel();

    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe(
      littConversationPaths.approval("conv-1", "pause-9"),
    );
    const init = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ decision: "rejected" });
  });
});
