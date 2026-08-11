-- Durable music generation claiming via FOR UPDATE SKIP LOCKED.
--
-- Replaces the brittle UPDATE + ORDER + LIMIT pattern in
-- processPendingGenerations() with a transaction-safe RPC that
-- prevents two workers from claiming the same generation.
--
-- Also adds observability columns: worker_id, attempt_count,
-- last_heartbeat_at, failure_code.

ALTER TABLE public.music_generations
ADD COLUMN IF NOT EXISTS worker_id TEXT,
ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS failure_code TEXT;

CREATE INDEX IF NOT EXISTS music_generations_worker_id
ON public.music_generations(worker_id)
WHERE worker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS music_generations_status_queued
ON public.music_generations(status)
WHERE status = 'queued';

-- claim_music_generations(worker_id, batch_size, lease_minutes)
--
-- Atomically claims up to `batch_size` queued generations for `worker_id`.
-- Sets status='claimed', worker_id, worker_lease_expires_at, and
-- increments attempt_count. Uses FOR UPDATE SKIP LOCKED so concurrent
-- workers never grab the same job.
--
-- Returns a table of claimed generation IDs.
CREATE OR REPLACE FUNCTION public.claim_music_generations(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 5,
  p_lease_minutes INTEGER DEFAULT 10
)
RETURNS TABLE(id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_lease_expires TIMESTAMPTZ := now() + (p_lease_minutes || ' minutes')::INTERVAL;
BEGIN
  WITH claimed AS (
    SELECT id
    FROM public.music_generations
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.music_generations g
  SET
    status = 'claimed',
    worker_id = p_worker_id,
    worker_lease_expires_at = v_lease_expires,
    last_heartbeat_at = now(),
    attempt_count = g.attempt_count + 1
  FROM claimed
  WHERE g.id = claimed.id
  RETURNING g.id;
END;
$$;

-- reclaim_stale_music_generations(lease_minutes)
--
-- Finds generations in active states whose worker lease has expired
-- (or that have been stuck past the stale threshold) and resets them
-- to 'queued' so they can be reclaimed. Uses FOR UPDATE SKIP LOCKED.
--
-- Returns the IDs of reclaimed generations.
CREATE OR REPLACE FUNCTION public.reclaim_stale_music_generations(
  p_stale_minutes INTEGER DEFAULT 5,
  p_lease_minutes INTEGER DEFAULT 10
)
RETURNS TABLE(id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_stale_cutoff TIMESTAMPTZ := now() - (p_stale_minutes || ' minutes')::INTERVAL;
  v_lease_cutoff TIMESTAMPTZ := now() - (p_lease_minutes || ' minutes')::INTERVAL;
BEGIN
  WITH stale AS (
    SELECT id
    FROM public.music_generations
    WHERE status IN ('preparing', 'generating', 'processing', 'claimed')
      AND (
        COALESCE(updated_at, created_at) < v_stale_cutoff
        OR (worker_lease_expires_at IS NOT NULL AND worker_lease_expires_at < v_lease_cutoff)
      )
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.music_generations g
  SET
    status = 'queued',
    started_at = NULL,
    worker_lease_expires_at = NULL,
    last_heartbeat_at = NULL
  FROM stale
  WHERE g.id = stale.id
  RETURNING g.id;
END;
$$;

-- heartbeat_music_generation(generation_id, worker_id)
--
-- Updates last_heartbeat_at and extends the worker lease for a
-- generation currently being processed. This keeps long-running
-- generations from being reclaimed by another worker.
CREATE OR REPLACE FUNCTION public.heartbeat_music_generation(
  p_generation_id UUID,
  p_worker_id TEXT,
  p_lease_minutes INTEGER DEFAULT 10
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated BOOLEAN := FALSE;
BEGIN
  UPDATE public.music_generations
  SET
    last_heartbeat_at = now(),
    worker_lease_expires_at = now() + (p_lease_minutes || ' minutes')::INTERVAL
  WHERE id = p_generation_id
    AND worker_id = p_worker_id
    AND status IN ('claimed', 'preparing', 'generating', 'processing');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
