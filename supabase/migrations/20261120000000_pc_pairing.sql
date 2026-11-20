-- Pairing control plane only. Existing device rows and IDs remain intact.
CREATE TABLE IF NOT EXISTS public.local_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  fingerprint text NOT NULL,
  public_key text,
  paired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_devices_user_fingerprint_key UNIQUE (user_id, fingerprint)
);

ALTER TABLE public.local_devices ADD COLUMN IF NOT EXISTS public_key text;
CREATE UNIQUE INDEX IF NOT EXISTS local_devices_user_fingerprint_pairing_idx
  ON public.local_devices (user_id, fingerprint);
-- A single key must never be routable to two accounts. Existing duplicates
-- must be resolved before applying this migration; no row is rewritten here.
CREATE UNIQUE INDEX IF NOT EXISTS local_devices_fingerprint_owner_idx
  ON public.local_devices (fingerprint);
CREATE INDEX IF NOT EXISTS local_devices_user_id_pairing_idx
  ON public.local_devices (user_id);

CREATE TABLE IF NOT EXISTS public.pc_pairing_sessions (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  consumed_at timestamptz,
  fingerprint text,
  public_key text,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pc_pairing_claim_complete CHECK (
    (claimed_at IS NULL AND fingerprint IS NULL AND public_key IS NULL AND name IS NULL)
    OR (claimed_at IS NOT NULL AND fingerprint IS NOT NULL AND public_key IS NOT NULL AND name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS pc_pairing_sessions_owner_idx
  ON public.pc_pairing_sessions (user_id, expires_at);

ALTER TABLE public.local_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_pairing_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_devices, public.pc_pairing_sessions FROM anon, authenticated;
GRANT ALL ON public.local_devices, public.pc_pairing_sessions TO service_role;

-- The owner confirmation and device activation share one transaction.
-- A revoked row is restored only through a fresh, unexpired, claimed code.
CREATE OR REPLACE FUNCTION public.complete_pc_pairing(p_user_id text, p_code_hash text)
RETURNS SETOF public.local_devices
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  WITH consumed AS (
    UPDATE public.pc_pairing_sessions
       SET consumed_at = now()
     WHERE code_hash = p_code_hash AND user_id = p_user_id
       AND claimed_at IS NOT NULL AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING user_id, fingerprint, public_key, name
  )
  INSERT INTO public.local_devices
    (user_id, fingerprint, public_key, name, paired_at, revoked_at)
  SELECT user_id, fingerprint, public_key, name, now(), NULL FROM consumed
  ON CONFLICT (user_id, fingerprint) DO UPDATE
    SET public_key = EXCLUDED.public_key, name = EXCLUDED.name,
        paired_at = EXCLUDED.paired_at, revoked_at = NULL,
        updated_at = now()
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.complete_pc_pairing(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pc_pairing(text, text) TO service_role;

COMMENT ON TABLE public.pc_pairing_sessions IS
  'Single-use owner-bound PC pairing codes; only a signed device claim may be owner-confirmed.';
