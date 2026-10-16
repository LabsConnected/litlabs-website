-- Provision the canonical "media" storage bucket.
--
-- /api/storage (signed upload URLs) and /api/upload both target the "media"
-- bucket, but it predates migrations — it was created manually in the Supabase
-- dashboard. Any environment provisioned purely from migrations (staging,
-- preview, fresh self-host) 500s on every signed-upload request with
-- "Bucket not found". The object-level SELECT policy for this bucket already
-- exists (20240614020000_security_linter_fixes.sql); this creates the bucket
-- itself. Public read matches the existing getPublicUrl() usage and the
-- "Media objects are publicly readable" policy.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
