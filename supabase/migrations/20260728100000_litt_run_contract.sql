-- ============================================
-- Phase 2: Canonical LiTT run contract.
--
-- Adds the columns and tables needed for the smallest canonical
-- vertical slice: conversation → kernel decision → run → typed events
-- → canonical messages → linked Canvas blocks → streamed response →
-- refresh recovery.
--
-- Reuses existing tables wherever possible:
--   - conversations (schema.sql) — unchanged
--   - canvases + canvas_blocks (20260728000000_canvas_system.sql) —
--     add transcript_turn block type + message_id column
--   - conversation_messages (schema.sql) — add canonical columns
--
-- New tables:
--   - litt_runs        — canonical run records
--   - litt_run_events  — ordered, replayable event log
--   - litt_kernel_decisions — persisted control decisions
--
-- RLS: deny anon + authenticated; service role bypasses (same pattern
-- as canvas_system and builder_chat_sessions).
-- ============================================

BEGIN;

-- ─── 1. Extend conversation_messages with canonical columns ───────
-- The existing table (schema.sql:333) has id, conversation_id, role,
-- content, metadata, created_at. We add the columns required by the
-- CanonicalMessage contract.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete'
    CHECK (status IN ('pending', 'streaming', 'complete', 'failed', 'cancelled'));
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS input_mode text NOT NULL DEFAULT 'text'
    CHECK (input_mode IN ('text', 'voice', 'tool'));
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS canvas_block_id uuid;
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS error jsonb;

CREATE INDEX IF NOT EXISTS conversation_messages_run_id_idx
  ON public.conversation_messages (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_created_idx
  ON public.conversation_messages (conversation_id, created_at);

-- Drop + recreate the updated_at trigger for conversation_messages
DROP TRIGGER IF EXISTS conversation_messages_touch_updated_at ON public.conversation_messages;
CREATE TRIGGER conversation_messages_touch_updated_at
  BEFORE UPDATE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── 2. Extend canvas_blocks with transcript_turn type ────────────
-- The existing CHECK (20260728000000) allows:
--   heading, paragraph, checklist, task, code, note, decision, image,
--   file, preview
-- We need to add 'transcript_turn' for LiTT conversation transcript
-- blocks. We also add a message_id column for direct block→message
-- linking (currently only in metadata).

ALTER TABLE public.canvas_blocks
  ADD COLUMN IF NOT EXISTS message_id text;

-- Replace the type CHECK to include transcript_turn
ALTER TABLE public.canvas_blocks
  DROP CONSTRAINT IF EXISTS canvas_blocks_type_check;
ALTER TABLE public.canvas_blocks
  ADD CONSTRAINT canvas_blocks_type_check CHECK (
    type IN ('heading','paragraph','checklist','task','code','note',
            'decision','image','file','preview','transcript_turn')
  );

CREATE INDEX IF NOT EXISTS canvas_blocks_message_id_idx
  ON public.canvas_blocks (message_id) WHERE message_id IS NOT NULL;

-- ─── 3. litt_runs — canonical run records ──────────────────────────
-- A run is one LiTT turn: user message → kernel decision → assistant
-- streaming → completion. Runs are linked to a conversation and
-- optionally a project/mission/canvas.

CREATE TABLE IF NOT EXISTS public.litt_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  -- The user message that triggered this run
  user_message_id uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  -- The assistant message produced by this run
  assistant_message_id uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  -- Kernel decision reference
  kernel_decision_id uuid,
  -- Optional context links
  project_id uuid,
  mission_id uuid,
  canvas_id uuid,
  -- Run state
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','streaming','completed','failed','cancelled')),
  -- Monotonic sequence counter for events in this run
  last_sequence integer NOT NULL DEFAULT 0,
  -- Error info (when status = failed)
  error jsonb,
  -- Retry linkage: if this run is a retry, points to the original run
  retry_of uuid REFERENCES public.litt_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS litt_runs_conversation_id_idx
  ON public.litt_runs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS litt_runs_user_id_idx
  ON public.litt_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS litt_runs_status_idx
  ON public.litt_runs (status) WHERE status IN ('pending','running','streaming');

-- ─── 4. litt_run_events — ordered, replayable event log ──────────
-- Every event in a run is persisted here before (or atomically with)
-- publication to the SSE stream. Reconnection replays events after
-- a supplied sequence number. Duplicate delivery is idempotent
-- because consumers key on (run_id, sequence).

CREATE TABLE IF NOT EXISTS public.litt_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.litt_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  -- The event type and payload (JSONB, validated in app layer)
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When the event was persisted
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Unique per (run_id, sequence) — prevents duplicate events
  UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS litt_run_events_run_id_sequence_idx
  ON public.litt_run_events (run_id, sequence);

-- ─── 5. litt_kernel_decisions — persisted control decisions ────────
-- Every request calls routeKernel(). The safe control-decision
-- summary is persisted here for audit and UI display.

CREATE TABLE IF NOT EXISTS public.litt_kernel_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.litt_runs(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  -- The full LiTTControlDecision (validated by Zod in app layer)
  decision jsonb NOT NULL,
  -- Safe summary for UI display (no hidden chain-of-thought)
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS litt_kernel_decisions_run_id_idx
  ON public.litt_kernel_decisions (run_id);

-- ─── 6. updated_at trigger for litt_runs ───────────────────────────
DROP TRIGGER IF EXISTS litt_runs_touch_updated_at ON public.litt_runs;
CREATE TRIGGER litt_runs_touch_updated_at
  BEFORE UPDATE ON public.litt_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── 7. Row Level Security ────────────────────────────────────────
-- Same pattern as canvas_system: deny anon + authenticated.
-- Service role (used by API routes) bypasses RLS entirely.

ALTER TABLE public.litt_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.litt_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.litt_kernel_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS litt_runs_deny_anon ON public.litt_runs;
CREATE POLICY litt_runs_deny_anon ON public.litt_runs
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS litt_runs_deny_authenticated ON public.litt_runs;
CREATE POLICY litt_runs_deny_authenticated ON public.litt_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS litt_run_events_deny_anon ON public.litt_run_events;
CREATE POLICY litt_run_events_deny_anon ON public.litt_run_events
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS litt_run_events_deny_authenticated ON public.litt_run_events;
CREATE POLICY litt_run_events_deny_authenticated ON public.litt_run_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS litt_kernel_decisions_deny_anon ON public.litt_kernel_decisions;
CREATE POLICY litt_kernel_decisions_deny_anon ON public.litt_kernel_decisions
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS litt_kernel_decisions_deny_authenticated ON public.litt_kernel_decisions;
CREATE POLICY litt_kernel_decisions_deny_authenticated ON public.litt_kernel_decisions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

COMMIT;
