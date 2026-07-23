-- Phase 2: GitHub project connection improvements
-- Adds connection status/error fields, selected branch, and timestamps
-- for reconnect and repository change support.

-- Add connection status and error tracking to projects
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'disconnected',
    ADD COLUMN IF NOT EXISTS connection_error text,
    ADD COLUMN IF NOT EXISTS connected_at timestamptz,
    ADD COLUMN IF NOT EXISTS disconnected_at timestamptz;

-- Add a distinct selected_branch column (separate from working_branch
-- which may diverge during active development)
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS selected_branch text;

-- Add repository metadata for reconnection and verification
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS repository_full_name text,
    ADD COLUMN IF NOT EXISTS repository_html_url text,
    ADD COLUMN IF NOT EXISTS repository_private boolean DEFAULT false;

-- Add index for connection_status lookups
CREATE INDEX IF NOT EXISTS idx_projects_connection_status
    ON projects(connection_status);

-- Update existing projects: set connection_status from status
UPDATE projects
SET connection_status = CASE
    WHEN status = 'ready' THEN 'connected'
    WHEN status = 'starting' THEN 'connecting'
    WHEN status = 'building' THEN 'connected'
    WHEN status = 'failed' THEN 'error'
    ELSE 'disconnected'
END
WHERE connection_status = 'disconnected';

-- Backfill selected_branch from working_branch where NULL
UPDATE projects
SET selected_branch = working_branch
WHERE selected_branch IS NULL;

-- Backfill repository_full_name from owner/repository
UPDATE projects
SET repository_full_name = owner || '/' || repository
WHERE repository_full_name IS NULL;
