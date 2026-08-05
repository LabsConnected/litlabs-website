/**
 * Source Registry — persistence layer for web research sources.
 *
 * Every web research result becomes a structured, citable WebSource record
 * stored in Supabase (public.web_sources). Both LiTT and Spark read from
 * this table — it is the shared research context that flows between agents.
 *
 * Uses the existing supabaseAdmin client. No new database — just a new
 * table in the existing Supabase project.
 *
 * Security: server-only module. BROWSERBASE_API_KEY and Supabase service
 * role key are never exposed to the client.
 */

import "server-only";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

// ─── Types ───────────────────────────────────────────────────────

export type WebSourceType =
  | "official"
  | "documentation"
  | "research"
  | "news"
  | "community"
  | "official_repository"
  | "official_documentation"
  | "official_api_spec"
  | "official_changelog"
  | "package_registry"
  | "maintainer_discussion"
  | "independent_analysis"
  | "community_discussion"
  | "research_paper"
  | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface WebSourceClaim {
  text: string;
  evidence?: string;
}

export interface WebSource {
  id: string;
  ownerId: string;
  projectId: string | null;
  url: string;
  title?: string;
  domain?: string;
  sourceType: WebSourceType;
  retrievedAt: string;
  content?: string;
  excerpt?: string;
  contentType?: string;
  statusCode?: number;
  claims?: WebSourceClaim[];
  screenshotUrl?: string;
  fileUrl?: string;
  verified?: boolean;
  verificationChecks?: Array<{ name: string; passed: boolean; detail: string }>;
  verificationWarnings?: string[];
  confidence?: ConfidenceLevel;
  browserbaseSessionId?: string;
  originOperation?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function toDbRow(source: Partial<WebSource> & { ownerId: string; url: string }): Record<string, unknown> {
  return {
    id: source.id ?? randomUUID(),
    owner_id: source.ownerId,
    project_id: source.projectId ?? null,
    url: source.url,
    title: source.title ?? null,
    domain: source.domain ?? extractDomain(source.url),
    source_type: source.sourceType ?? "unknown",
    retrieved_at: source.retrievedAt ?? new Date().toISOString(),
    content: source.content ?? null,
    excerpt: source.excerpt ?? null,
    content_type: source.contentType ?? "text/html",
    status_code: source.statusCode ?? null,
    claims: source.claims ? JSON.stringify(source.claims) : "[]",
    screenshot_url: source.screenshotUrl ?? null,
    file_url: source.fileUrl ?? null,
    verified: source.verified ?? false,
    verification_checks: source.verificationChecks ? JSON.stringify(source.verificationChecks) : "[]",
    verification_warnings: source.verificationWarnings ? JSON.stringify(source.verificationWarnings) : "[]",
    confidence: source.confidence ?? "medium",
    browserbase_session_id: source.browserbaseSessionId ?? null,
    origin_operation: source.originOperation ?? "fetch",
    metadata: source.metadata ? JSON.stringify(source.metadata) : "{}",
  };
}

function fromDbRow(row: Record<string, unknown>): WebSource {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    projectId: (row.project_id as string) ?? null,
    url: row.url as string,
    title: (row.title as string) ?? undefined,
    domain: (row.domain as string) ?? undefined,
    sourceType: row.source_type as WebSourceType,
    retrievedAt: row.retrieved_at as string,
    content: (row.content as string) ?? undefined,
    excerpt: (row.excerpt as string) ?? undefined,
    contentType: (row.content_type as string) ?? undefined,
    statusCode: (row.status_code as number) ?? undefined,
    claims: row.claims as WebSourceClaim[] | undefined,
    screenshotUrl: (row.screenshot_url as string) ?? undefined,
    fileUrl: (row.file_url as string) ?? undefined,
    verified: (row.verified as boolean) ?? false,
    verificationChecks: row.verification_checks as WebSource["verificationChecks"] | undefined,
    verificationWarnings: row.verification_warnings as string[] | undefined,
    confidence: row.confidence as ConfidenceLevel | undefined,
    browserbaseSessionId: (row.browserbase_session_id as string) ?? undefined,
    originOperation: (row.origin_operation as string) ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── Source Registry Service ─────────────────────────────────────

export class SourceRegistry {
  /**
   * Save a web source to the registry. Upserts by URL + owner + project
   * so re-fetching the same page updates the record instead of duplicating.
   */
  async save(source: Partial<WebSource> & { ownerId: string; url: string }): Promise<WebSource | null> {
    try {
      const row = toDbRow(source);
      const { data, error } = await supabaseAdmin
        .from("web_sources")
        .upsert(row, {
          onConflict: "owner_id,url,project_id",
        })
        .select()
        .single();

      if (error) return null;
      return fromDbRow(data as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /**
   * Save multiple sources in one call.
   */
  async saveBatch(sources: Array<Partial<WebSource> & { ownerId: string; url: string }>): Promise<WebSource[]> {
    if (sources.length === 0) return [];
    try {
      const rows = sources.map(toDbRow);
      const { data, error } = await supabaseAdmin
        .from("web_sources")
        .upsert(rows, {
          onConflict: "owner_id,url,project_id",
        })
        .select();

      if (error || !data) return [];
      return (data as Record<string, unknown>[]).map(fromDbRow);
    } catch {
      return [];
    }
  }

  /**
   * Get a source by ID.
   */
  async getById(id: string): Promise<WebSource | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from("web_sources")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) return null;
      return fromDbRow(data as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /**
   * List sources for a project, most recent first.
   */
  async listForProject(
    ownerId: string,
    projectId: string,
    options?: { limit?: number; domain?: string },
  ): Promise<WebSource[]> {
    try {
      let query = supabaseAdmin
        .from("web_sources")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(options?.limit ?? 20);

      if (options?.domain) {
        query = query.eq("domain", options.domain);
      }

      const { data, error } = await query;
      if (error || !data) return [];
      return (data as Record<string, unknown>[]).map(fromDbRow);
    } catch {
      return [];
    }
  }

  /**
   * Find existing sources for a URL (to check cache freshness).
   */
  async findByUrl(url: string, ownerId: string, projectId?: string): Promise<WebSource | null> {
    try {
      let query = supabaseAdmin
        .from("web_sources")
        .select("*")
        .eq("url", url)
        .eq("owner_id", ownerId)
        .order("retrieved_at", { ascending: false })
        .limit(1);

      if (projectId) {
        query = query.eq("project_id", projectId);
      }

      const { data, error } = await query;
      if (error || !data || data.length === 0) return null;
      return fromDbRow(data[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /**
   * Update a source with new evidence (screenshot, claims, etc.).
   */
  async update(id: string, updates: Partial<WebSource>): Promise<WebSource | null> {
    try {
      const row: Record<string, unknown> = {};
      if (updates.title !== undefined) row.title = updates.title;
      if (updates.content !== undefined) row.content = updates.content;
      if (updates.excerpt !== undefined) row.excerpt = updates.excerpt;
      if (updates.claims !== undefined) row.claims = JSON.stringify(updates.claims);
      if (updates.screenshotUrl !== undefined) row.screenshot_url = updates.screenshotUrl;
      if (updates.fileUrl !== undefined) row.file_url = updates.fileUrl;
      if (updates.verified !== undefined) row.verified = updates.verified;
      if (updates.verificationChecks !== undefined) row.verification_checks = JSON.stringify(updates.verificationChecks);
      if (updates.verificationWarnings !== undefined) row.verification_warnings = JSON.stringify(updates.verificationWarnings);
      if (updates.confidence !== undefined) row.confidence = updates.confidence;
      if (updates.metadata !== undefined) row.metadata = JSON.stringify(updates.metadata);
      row.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from("web_sources")
        .update(row)
        .eq("id", id)
        .select()
        .single();

      if (error) return null;
      return fromDbRow(data as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /**
   * Delete a source.
   */
  async delete(id: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from("web_sources")
        .delete()
        .eq("id", id);
      return !error;
    } catch {
      return false;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────

let _registry: SourceRegistry | null = null;

export function getSourceRegistry(): SourceRegistry {
  if (!_registry) _registry = new SourceRegistry();
  return _registry;
}
