/**
 * Run Event Store
 *
 * Persists RunEvent records for the Activity panel.
 * Same pattern as evidence-store.ts: in-memory for tests,
 * Supabase for production.
 *
 * Phase 7 — Studio Control Plane V1
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import type { RunEvent } from "./run-events";
import { InMemoryEvidenceStore } from "./evidence-store";

// ─── Interface ───────────────────────────────────────────────────

export interface RunEventStore {
  insert(event: RunEvent): Promise<void>;
  listByRun(runId: string): Promise<RunEvent[]>;
  listByProject(projectId: string, limit?: number): Promise<RunEvent[]>;
}

// ─── In-Memory ───────────────────────────────────────────────────

export class InMemoryRunEventStore implements RunEventStore {
  private events: RunEvent[] = [];

  async insert(event: RunEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async listByRun(runId: string): Promise<RunEvent[]> {
    return this.events
      .filter((e) => e.runId === runId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async listByProject(projectId: string, limit = 100): Promise<RunEvent[]> {
    return this.events
      .filter((e) => e.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

// ─── Supabase ────────────────────────────────────────────────────

class SupabaseRunEventStore implements RunEventStore {
  async insert(event: RunEvent): Promise<void> {
    const client = getSupabaseAdmin();
    if (!client) return;

    const { error } = await client.from("run_events").insert({
      id: event.id,
      run_id: event.runId,
      project_id: event.projectId,
      user_id: event.userId ?? null,
      event_type: event.eventType,
      event_data: event.eventData,
      evidence_id: event.evidenceId ?? null,
      created_at: event.createdAt,
    });
    if (error) {
      console.error("[run-event-store] insert failed:", error.message);
    }
  }

  async listByRun(runId: string): Promise<RunEvent[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];

    const { data, error } = await client
      .from("run_events")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data.map(rowToEvent);
  }

  async listByProject(projectId: string, limit = 100): Promise<RunEvent[]> {
    const client = getSupabaseAdmin();
    if (!client) return [];

    const { data, error } = await client
      .from("run_events")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(rowToEvent);
  }
}

function rowToEvent(row: Record<string, unknown>): RunEvent {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    userId: (row.user_id as string) ?? undefined,
    eventType: row.event_type as RunEvent["eventType"],
    eventData: (row.event_data as Record<string, unknown>) ?? {},
    evidenceId: (row.evidence_id as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

// ─── Singleton ───────────────────────────────────────────────────

let runEventStoreInstance: RunEventStore | null = null;

export function getRunEventStore(): RunEventStore {
  if (!runEventStoreInstance) {
    const client = getSupabaseAdmin();
    runEventStoreInstance = client ? new SupabaseRunEventStore() : new InMemoryRunEventStore();
  }
  return runEventStoreInstance;
}

/** Reset — for testing only */
export function resetRunEventStore(): void {
  runEventStoreInstance = new InMemoryRunEventStore();
}
