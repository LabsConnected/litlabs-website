"use client";

/**
 * Studio import path for approval submit and poll.
 * Implementation lives in `@/lib/litt-client/approval-polling`.
 */
export {
  submitApprovalAndPoll,
  watchApprovalResolution,
} from "@/lib/litt-client/approval-polling";
export type {
  ApprovalRunResult,
  ApprovalRunStatus,
  ApprovalWatchOutcome,
} from "@/lib/litt-client/approval-polling";
