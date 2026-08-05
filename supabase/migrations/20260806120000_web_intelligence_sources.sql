-- LiTT Web Intelligence — Source Registry
--
-- Stores structured web source records produced by the Web Intelligence
-- Layer. Every research result becomes a persistent, citable source with
-- URL, title, domain, source type, retrieval timestamp, extracted content,
-- claims, evidence (screenshots/PDFs), and confidence.
--
-- This table is SEPARATE from project_knowledge (which stores synthesized
-- findings) and memories (which stores conversation context). Web sources
-- are the raw evidence; project_knowledge entries reference them.
--
-- Both LiTT and Spark read from this table — it is the shared research
-- context that flows between agents.

CREATE TABLE IF NOT EXISTS public.web_sources (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,
  project_id TEXT,

  -- Core source identity
  url TEXT NOT NULL,
  title TEXT,
  domain TEXT,

  -- Source classification (aligns with the existing research taxonomy)
  source_type TEXT NOT NULL DEFAULT 'unknown' CHECK (
    source_type IN (
      'official',
      'documentation',
      'research',
      'news',
      'community',
      'official_repository',
      'official_documentation',
      'official_api_spec',
      'official_changelog',
      'package_registry',
      'maintainer_discussion',
      'independent_analysis',
      'community_discussion',
      'research_paper',
      'unknown'
    )
  ),

  -- Retrieval metadata
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Content (truncated for storage; full content may be in R2 for large pages)
  content TEXT,
  excerpt TEXT,
  content_type TEXT DEFAULT 'text/html',
  status_code INTEGER,

  -- Structured claims extracted from the source
  claims JSONB DEFAULT '[]'::jsonb,

  -- Evidence artifacts (R2 URLs for screenshots, PDFs, downloads)
  screenshot_url TEXT,
  file_url TEXT,

  -- Verification + confidence
  verified BOOLEAN DEFAULT false,
  verification_checks JSONB DEFAULT '[]'::jsonb,
  verification_warnings JSONB DEFAULT '[]'::jsonb,
  confidence TEXT DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),

  -- Browserbase session reference (for replay/debugging)
  browserbase_session_id TEXT,

  -- Which operation produced this source
  origin_operation TEXT DEFAULT 'fetch',

  -- Metadata for extensibility
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_web_sources_owner_project ON public.web_sources(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_web_sources_url ON public.web_sources(url);
CREATE INDEX IF NOT EXISTS idx_web_sources_domain ON public.web_sources(domain);
CREATE INDEX IF NOT EXISTS idx_web_sources_retrieved ON public.web_sources(retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_sources_project_created ON public.web_sources(project_id, created_at DESC);

-- ─── Web Monitor Definitions ────────────────────────────────────
-- Stores reusable page-monitoring definitions for the "monitor" operation.
-- The Web Intelligence Layer checks these on a schedule and reports changes.

CREATE TABLE IF NOT EXISTS public.web_monitors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,
  project_id TEXT,

  -- What to watch
  url TEXT NOT NULL,
  label TEXT,
  extraction_target TEXT NOT NULL,
  extraction_schema JSONB DEFAULT '{}'::jsonb,

  -- Change detection state
  last_value TEXT,
  last_checked_at TIMESTAMPTZ,
  last_source_id TEXT REFERENCES public.web_sources(id) ON DELETE SET NULL,
  change_count INTEGER NOT NULL DEFAULT 0,
  last_change_at TIMESTAMPTZ,

  -- Scheduling
  check_interval_seconds INTEGER NOT NULL DEFAULT 3600,
  enabled BOOLEAN NOT NULL DEFAULT true,

  -- Notification
  notify_on_change BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_monitors_owner ON public.web_monitors(owner_id);
CREATE INDEX IF NOT EXISTS idx_web_monitors_enabled_next ON public.web_monitors(enabled, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_web_monitors_project ON public.web_monitors(project_id);

-- ─── RLS Policies ───────────────────────────────────────────────
-- Web sources are scoped to the owner. Project members can read sources
-- for their project. Service role bypasses RLS for internal operations.

ALTER TABLE public.web_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_monitors ENABLE ROW LEVEL SECURITY;

-- Owners can CRUD their own sources
CREATE POLICY web_sources_owner_select ON public.web_sources
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY web_sources_owner_insert ON public.web_sources
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY web_sources_owner_update ON public.web_sources
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY web_sources_owner_delete ON public.web_sources
  FOR DELETE USING (owner_id = auth.jwt() ->> 'sub');

-- Owners can CRUD their own monitors
CREATE POLICY web_monitors_owner_select ON public.web_monitors
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY web_monitors_owner_insert ON public.web_monitors
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY web_monitors_owner_update ON public.web_monitors
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY web_monitors_owner_delete ON public.web_monitors
  FOR DELETE USING (owner_id = auth.jwt() ->> 'sub');
