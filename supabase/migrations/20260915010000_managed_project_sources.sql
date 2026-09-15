-- Give every Studio project a durable source identity independent of GitHub.
ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS source_id UUID DEFAULT gen_random_uuid();

UPDATE public.studio_projects
SET source_id = COALESCE(source_id, gen_random_uuid())
WHERE source_id IS NULL;

ALTER TABLE public.studio_projects
  ALTER COLUMN source_id SET NOT NULL;

ALTER TABLE public.studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_source_type_check;

ALTER TABLE public.studio_projects
  ADD CONSTRAINT studio_projects_source_type_check
  CHECK (source_type IN ('github', 'managed', 'blank', 'template'));

CREATE INDEX IF NOT EXISTS studio_projects_source_id_idx
  ON public.studio_projects(source_id);
