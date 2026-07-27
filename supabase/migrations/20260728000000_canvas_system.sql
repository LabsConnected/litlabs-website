-- ============================================
-- Canvas system — artifact-backed structured
-- work surfaces bound to conversations, projects,
-- and missions. Every mutation is recorded in
-- canvas_revisions for undo/redo and audit.
--
-- Tables:
--   canvases          — one per conversation/topic
--   canvas_blocks     — structured blocks inside a canvas
--   canvas_revisions  — versioned mutation log
--
-- RLS: deny anon + authenticated; service role bypasses.
-- This matches the builder_chat_sessions pattern.
-- ============================================

BEGIN;

-- ─── Canvases ──────────────────────────────────────────────────
-- A Canvas is a structured work surface. It may be standalone
-- (conversation-only) or linked to a project and/or mission.

CREATE TABLE IF NOT EXISTS public.canvases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner (Clerk user id, matching builder_chat_sessions.clerk_user_id)
  user_id text NOT NULL,
  -- Optional links to the canonical hierarchy
  project_id uuid REFERENCES public.studio_projects(id) ON DELETE SET NULL,
  mission_id uuid REFERENCES public.missions(id) ON DELETE SET NULL,
  -- The conversation that owns this canvas (builder_chat_sessions.id is a uuid)
  conversation_id text,
  -- Display
  title text NOT NULL DEFAULT 'Untitled Canvas',
  type text NOT NULL DEFAULT 'document'
    CHECK (type IN ('document','website','code','research','marketing','planning','notes','custom')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  -- Monotonic version — bumped on every canvas_revisions insert
  version integer NOT NULL DEFAULT 1,
  -- Free-form metadata for focus state, pinned blocks, etc.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvases_user_id_idx
  ON public.canvases (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS canvases_conversation_id_idx
  ON public.canvases (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS canvases_project_id_idx
  ON public.canvases (project_id) WHERE project_id IS NOT NULL;

-- ─── Canvas blocks ─────────────────────────────────────────────
-- Each block is a typed, independently-editable unit inside a
-- canvas. Blocks have stable ids so LiTT can update one block
-- without rewriting the whole canvas.

CREATE TABLE IF NOT EXISTS public.canvas_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id uuid NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  -- Block type — initial release supports these types
  type text NOT NULL
    CHECK (type IN ('heading','paragraph','checklist','task','code','note','decision','image','file','preview')),
  -- Block content — shape depends on type (validated in app layer)
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ordering within the canvas (manual drag + append)
  position double precision NOT NULL DEFAULT 0,
  -- Optional metadata (collapsed, pinned, source message id, etc.)
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvas_blocks_canvas_id_idx
  ON public.canvas_blocks (canvas_id, position);

-- ─── Canvas revisions ──────────────────────────────────────────
-- Every mutation (create/append/update_block/delete_block/rename)
-- records a revision. This powers undo, redo, view changes, and
-- restore version. The version number on canvases is bumped to
-- match revision.version on every insert.

CREATE TABLE IF NOT EXISTS public.canvas_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id uuid NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
  version integer NOT NULL,
  actor text NOT NULL
    CHECK (actor IN ('user','litt','spark','system')),
  -- The chat message that triggered this revision (nullable for system)
  source_message_id text,
  -- Human-readable summary ("Added heading: Requirements")
  summary text NOT NULL DEFAULT '',
  -- The operations applied in this revision
  operations jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Snapshot of block ids+versions after this revision (for restore)
  -- Stored as [{id, type, content, position, metadata}] for full restore.
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvas_revisions_canvas_id_idx
  ON public.canvas_revisions (canvas_id, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS canvas_revisions_canvas_version_idx
  ON public.canvas_revisions (canvas_id, version);

-- ─── updated_at triggers ───────────────────────────────────────
-- Keep updated_at fresh on every row update.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS canvases_touch_updated_at ON public.canvases;
CREATE TRIGGER canvases_touch_updated_at
  BEFORE UPDATE ON public.canvases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS canvas_blocks_touch_updated_at ON public.canvas_blocks;
CREATE TRIGGER canvas_blocks_touch_updated_at
  BEFORE UPDATE ON public.canvas_blocks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── Row Level Security ────────────────────────────────────────
-- Match the builder_chat_sessions pattern: deny anon + authenticated.
-- The service role (used by API routes) bypasses RLS entirely.

ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canvases_deny_anon ON public.canvases;
CREATE POLICY canvases_deny_anon ON public.canvases
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS canvases_deny_authenticated ON public.canvases;
CREATE POLICY canvases_deny_authenticated ON public.canvases
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS canvas_blocks_deny_anon ON public.canvas_blocks;
CREATE POLICY canvas_blocks_deny_anon ON public.canvas_blocks
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS canvas_blocks_deny_authenticated ON public.canvas_blocks;
CREATE POLICY canvas_blocks_deny_authenticated ON public.canvas_blocks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS canvas_revisions_deny_anon ON public.canvas_revisions;
CREATE POLICY canvas_revisions_deny_anon ON public.canvas_revisions
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS canvas_revisions_deny_authenticated ON public.canvas_revisions;
CREATE POLICY canvas_revisions_deny_authenticated ON public.canvas_revisions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

COMMIT;
