/**
 * Call Payload Types
 *
 * Normalized call data sent to the orchestration layer (n8n) after a
 * Vapi call ends. n8n then routes to CRM, email, Slack, GHL, or
 * whatever downstream systems are configured — LiTT no longer
 * talks to GHL directly for voice calls.
 *
 * LiTT handles intelligence (intent classification, lead scoring,
 * summary). This payload is the bridge to the orchestration layer.
 */

export type IntentTag =
  | "intent:website"
  | "intent:ai"
  | "intent:branding"
  | "intent:music"
  | "intent:support"
  | "intent:other";

export type LeadStatus = "hot" | "warm" | "cold" | "not-lead";

export interface CallPayload {
  /** Vapi call ID */
  callId: string;
  /** Business number the caller dialed */
  to: string;
  /** Caller's phone number in E.164 */
  from: string;
  /** Caller name if known from CRM/account */
  callerName: string | null;
  /** ISO timestamp when call started */
  startedAt: string;
  /** ISO timestamp when call ended */
  endedAt: string;
  /** Call duration in milliseconds */
  durationMs: number;
  /** Call status from Vapi */
  status: string;
  /** Classified intent tag */
  intent: IntentTag;
  /** Lead temperature */
  leadStatus: LeadStatus;
  /** LiTT determined this caller needs human follow-up */
  followUpNeeded: boolean;
  /** Short AI-generated summary of the call */
  summary: string;
  /** Whether the caller is a known LiTT user */
  isKnownUser: boolean;
  /** LiTT user ID if known */
  userId: string | null;
  /** Active project discussed (if any) */
  projectId: string | null;
  /** Project name (if any) */
  projectName: string | null;
  /** Full transcript (optional, can be redacted) */
  transcript: string | null;
  /** Conversation ID in LiTT */
  conversationId: string | null;
}

// Backward compat: GHLCallPayload is now just CallPayload
export type GHLCallPayload = CallPayload;
