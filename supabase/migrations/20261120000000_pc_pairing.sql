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
  pairing_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (pg_catalog.clock_timestamp() + interval '10 minutes'),
  claimed_at timestamptz,
  consumed_at timestamptz,
  fingerprint text,
  public_key text,
  name text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT pc_pairing_claim_complete CHECK (
    (claimed_at IS NULL AND fingerprint IS NULL AND public_key IS NULL AND name IS NULL)
    OR (claimed_at IS NOT NULL AND fingerprint IS NOT NULL AND public_key IS NOT NULL AND name IS NOT NULL)
  )
);

ALTER TABLE public.pc_pairing_sessions
  ADD COLUMN IF NOT EXISTS pairing_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS pc_pairing_sessions_pairing_id_idx
  ON public.pc_pairing_sessions (pairing_id);
CREATE INDEX IF NOT EXISTS pc_pairing_sessions_owner_idx
  ON public.pc_pairing_sessions (user_id, expires_at);

ALTER TABLE public.local_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_pairing_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_devices, public.pc_pairing_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.local_devices, public.pc_pairing_sessions TO service_role;

-- All operations for one owner take the owner lock first. Operations on an
-- existing identity then take the fingerprint lock. This keeps issuance,
-- claim, confirmation, and revocation ordered across API instances.
CREATE OR REPLACE FUNCTION public.issue_pc_pairing(
  p_user_id text, p_code_hash text, p_pairing_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  issued_at timestamptz;
  expiry timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pc-pairing-owner:' || p_user_id));
  issued_at := pg_catalog.clock_timestamp();
  INSERT INTO public.pc_pairing_sessions
    (user_id, code_hash, pairing_id, created_at, expires_at)
  VALUES (p_user_id, p_code_hash, p_pairing_id, issued_at, issued_at + interval '10 minutes')
  RETURNING expires_at INTO expiry;
  RETURN expiry;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_pc_pairing(
  p_code_hash text, p_fingerprint text, p_public_key text, p_name text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  pairing_row public.pc_pairing_sessions%ROWTYPE;
  device_row public.local_devices%ROWTYPE;
  pairing_owner text;
BEGIN
  SELECT user_id INTO pairing_owner FROM public.pc_pairing_sessions WHERE code_hash = p_code_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pc-pairing-owner:' || pairing_owner));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_fingerprint));
  SELECT * INTO pairing_row FROM public.pc_pairing_sessions
   WHERE code_hash = p_code_hash AND claimed_at IS NULL AND consumed_at IS NULL
     AND expires_at > pg_catalog.clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO device_row FROM public.local_devices
   WHERE fingerprint = p_fingerprint FOR UPDATE;
  IF FOUND AND (device_row.user_id <> pairing_row.user_id OR
      (device_row.revoked_at IS NOT NULL AND pairing_row.created_at <= device_row.revoked_at))
    THEN RETURN false;
  END IF;

  UPDATE public.pc_pairing_sessions
     SET claimed_at = pg_catalog.clock_timestamp(), fingerprint = p_fingerprint,
         public_key = p_public_key, name = p_name
   WHERE code_hash = p_code_hash;
  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.complete_pc_pairing(text, text);
CREATE OR REPLACE FUNCTION public.complete_pc_pairing(p_user_id text, p_pairing_id uuid)
RETURNS SETOF public.local_devices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  pairing_row public.pc_pairing_sessions%ROWTYPE;
  device_row public.local_devices%ROWTYPE;
BEGIN
  SELECT * INTO pairing_row FROM public.pc_pairing_sessions
   WHERE pairing_id = p_pairing_id AND user_id = p_user_id
     AND claimed_at IS NOT NULL AND consumed_at IS NULL
     AND expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pc-pairing-owner:' || p_user_id));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(pairing_row.fingerprint));
  SELECT * INTO pairing_row FROM public.pc_pairing_sessions
   WHERE pairing_id = p_pairing_id AND user_id = p_user_id
     AND claimed_at IS NOT NULL AND consumed_at IS NULL
     AND expires_at > pg_catalog.clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO device_row FROM public.local_devices
   WHERE fingerprint = pairing_row.fingerprint FOR UPDATE;
  IF FOUND AND (device_row.user_id <> p_user_id OR
      (device_row.revoked_at IS NOT NULL AND pairing_row.created_at <= device_row.revoked_at))
    THEN RETURN;
  END IF;

  UPDATE public.pc_pairing_sessions
     SET consumed_at = pg_catalog.clock_timestamp()
   WHERE pairing_id = p_pairing_id;
  INSERT INTO public.local_devices
    (user_id, fingerprint, public_key, name, paired_at, revoked_at)
  VALUES (p_user_id, pairing_row.fingerprint, pairing_row.public_key,
          pairing_row.name, pg_catalog.clock_timestamp(), NULL)
  ON CONFLICT (user_id, fingerprint) DO UPDATE
    SET public_key = EXCLUDED.public_key, name = EXCLUDED.name,
        paired_at = EXCLUDED.paired_at, revoked_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
  RETURNING * INTO device_row;
  RETURN NEXT device_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_pc_device(p_user_id text, p_device_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  device_fingerprint text;
  revoked_time timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pc-pairing-owner:' || p_user_id));
  SELECT fingerprint INTO device_fingerprint FROM public.local_devices
   WHERE id = p_device_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(device_fingerprint));
  UPDATE public.local_devices
     SET revoked_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
   WHERE id = p_device_id AND user_id = p_user_id AND revoked_at IS NULL
   RETURNING revoked_at INTO revoked_time;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.pc_pairing_sessions
     SET consumed_at = revoked_time
   WHERE user_id = p_user_id
     AND consumed_at IS NULL AND created_at <= revoked_time;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_pc_pairing(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_pc_pairing(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_pc_pairing(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_pc_device(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_pc_pairing(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pc_pairing(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_pc_pairing(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_pc_device(text, uuid) TO service_role;

COMMENT ON TABLE public.pc_pairing_sessions IS
  'Single-use owner-bound PC pairing codes; only a signed device claim may be owner-confirmed.';
