import "server-only";

import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Anonymous demo usage logging — written to a SEPARATE table (demo_logs),
 * never mixed with authenticated agent/conversation logs.
 *
 * The insert is wrapped in try/catch and degrades gracefully: if Larry hasn't
 * run the migration yet (see supabase/migrations/*_demo_logs.sql), the chat
 * request still succeeds — logging must never break the demo.
 *
 * Only hashes are stored: sha256(sessionId) and sha256(ip). No raw session
 * ids, no raw IPs, no message content.
 */

export interface DemoLogEntry {
  /** sha256 hex of the demo session UUID */
  sessionHash: string;
  /** 1-based index of this message within the session */
  messageIndex: number;
  promptTokens: number;
  completionTokens: number;
  provider: string;
  model: string;
  /** sha256 hex of the client IP (or "unknown") */
  ipHash: string;
}

export function hashDemoValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function logDemoUsage(entry: DemoLogEntry): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    const { error } = await admin.from("demo_logs").insert({
      session_hash: entry.sessionHash,
      message_index: entry.messageIndex,
      prompt_tokens: entry.promptTokens,
      completion_tokens: entry.completionTokens,
      provider: entry.provider,
      model: entry.model,
      ip_hash: entry.ipHash,
    });
    if (error) {
      // Missing table (migration not run yet) or RLS — degrade silently.
      console.warn(`[demo] demo_logs insert failed (degraded): ${error.message}`);
    }
  } catch (err) {
    console.warn(
      `[demo] demo_logs insert threw (degraded): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
