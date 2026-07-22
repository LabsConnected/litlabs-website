-- LiTT Base Station — Per-User Station Layout Persistence
-- Phase 2.3 of the LiTT Base Station cleanup. Creates the table that
-- stores the user's saved visual state of the Base Station (2.5D DOM/CSS in
-- Phase 5, eventually React Three Fiber): the position of LiTT, the position
-- of Spark, the docked tools, the chosen skin, the home zone, etc.
--
-- The `layout` column is a free-form JSONB document so the Base Station can
-- evolve its shape without database migrations. The `version` column is a
-- monotonic counter incremented on every write so a client can detect lost
-- updates and the server can reject stale writes.
--
-- RLS: every row is owned by a single Clerk user_id (string). A user can
-- only read / insert / update / delete their own row. No service-role bypass
-- here — the Base Station layout is strictly user-scoped.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_station_layouts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,
  layout      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One layout per user. The unique index also serves the "fetch mine" query.
  CONSTRAINT agent_station_layouts_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_station_layouts_user_id
  ON public.agent_station_layouts (user_id);

CREATE INDEX IF NOT EXISTS idx_agent_station_layouts_updated_at
  ON public.agent_station_layouts (updated_at DESC);

ALTER TABLE public.agent_station_layouts ENABLE ROW LEVEL SECURITY;

-- RLS policy: the user can fully manage their own row only.
-- We map Clerk's user id (text) to Supabase's auth.uid() (uuid) by string-casting.
DROP POLICY IF EXISTS "Users can manage their own station layout" ON public.agent_station_layouts;
CREATE POLICY "Users can manage their own station layout"
  ON public.agent_station_layouts
  FOR ALL
  USING      (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- updated_at trigger (re-uses the update_updated_at_column() function already
-- defined in earlier migrations; create it if this migration runs in isolation).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_station_layouts_updated_at ON public.agent_station_layouts;
CREATE TRIGGER update_agent_station_layouts_updated_at
  BEFORE UPDATE ON public.agent_station_layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
