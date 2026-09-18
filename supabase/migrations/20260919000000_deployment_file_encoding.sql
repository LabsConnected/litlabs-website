-- ============================================================
-- Explicit storage kind for deployment artifact files.
--
-- Binary artifacts (images, fonts, wasm, ...) are stored base64 because
-- the content column is text-shaped. Until now the encoding was implicit
-- and inferred from content_type at serve time; making it an explicit
-- column means a stored row is self-describing and cannot be misdecoded
-- if content-type inference ever changes.
--
-- 'utf-8' default keeps every pre-existing row valid — no binary row was
-- ever successfully written before the encoding-aware collector shipped
-- (binary writes failed at insert), so defaulting to text is correct.
-- ============================================================

ALTER TABLE public.user_project_deployment_files
  ADD COLUMN IF NOT EXISTS encoding text NOT NULL DEFAULT 'utf-8';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_project_deployment_files'::regclass
      AND conname = 'user_project_deployment_files_encoding_check'
  ) THEN
    ALTER TABLE public.user_project_deployment_files
      ADD CONSTRAINT user_project_deployment_files_encoding_check
      CHECK (encoding IN ('utf-8', 'base64'));
  END IF;
END $$;
