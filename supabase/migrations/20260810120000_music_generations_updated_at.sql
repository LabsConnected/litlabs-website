-- Add updated_at column to music_generations for stale-job recovery.
-- The existing claimStaleGenerations() function queries updated_at, but
-- this column was missing from the original migration, causing recovery
-- to silently fail (query error → return []).

ALTER TABLE public.music_generations
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Reuse the shared update_updated_at_column() function if it exists,
-- otherwise create a dedicated one for music_generations.
CREATE OR REPLACE FUNCTION public.update_music_generations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_music_generations_updated_at
ON public.music_generations;

CREATE TRIGGER update_music_generations_updated_at
BEFORE UPDATE ON public.music_generations
FOR EACH ROW
EXECUTE FUNCTION public.update_music_generations_updated_at();

-- Add 'claimed' to the status CHECK constraint.
ALTER TABLE public.music_generations
DROP CONSTRAINT IF EXISTS music_generations_status_check;

ALTER TABLE public.music_generations
ADD CONSTRAINT music_generations_status_check
CHECK (status IN (
  'queued', 'claimed', 'preparing', 'generating', 'processing', 'completed', 'failed', 'cancelled'
));

-- Backfill updated_at for existing rows so they have a valid timestamp.
UPDATE public.music_generations
SET updated_at = created_at
WHERE updated_at IS NULL;

-- Add cancel_requested_at column for real cancellation state.
-- This allows processGeneration to check for cancellation requests
-- without the race condition of directly setting status='cancelled'.
ALTER TABLE public.music_generations
ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;

-- Add worker_lease_expires_at column for atomic job claiming.
-- A worker sets this when claiming a job; if the lease expires,
-- another worker can reclaim the job.
ALTER TABLE public.music_generations
ADD COLUMN IF NOT EXISTS worker_lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS music_generations_updated_at
ON public.music_generations(updated_at);

CREATE INDEX IF NOT EXISTS music_generations_worker_lease
ON public.music_generations(worker_lease_expires_at)
WHERE worker_lease_expires_at IS NOT NULL;
