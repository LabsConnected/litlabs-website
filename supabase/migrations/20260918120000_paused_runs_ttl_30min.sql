-- Approval TTL: 5 minutes -> 30 minutes.
--
-- Approvals arrive on a phone — the user may be mid-task, on a call, or away
-- from the screen. A 5-minute TTL expired gates before people could act, and
-- every expiry dead-ended the run. The gate stays single-use and
-- server-authoritative; only the decision window is humane.
--
-- NOTE (flagged for human run): apply this in the Supabase dashboard SQL
-- editor (or via the project's migration runner). New paused-run rows also
-- compute expires_at from the 30-minute constant in application code
-- (paused-run-store.ts), so this migration only affects the column default
-- for any rows inserted outside the app.
ALTER TABLE agent_paused_runs
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 minutes');
