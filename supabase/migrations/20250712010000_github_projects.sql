-- GitHub App integration and project workspace tables

-- Stores GitHub App installations per user. We never store installation tokens here;
-- short-lived tokens are generated on demand using the GitHub App private key.
CREATE TABLE IF NOT EXISTS github_installations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    installation_id bigint NOT NULL,
    setup_action text,
    state text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (user_id, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_github_installations_user
    ON github_installations(user_id);

-- Stores incoming GitHub webhook events for audit and sync processing.
CREATE TABLE IF NOT EXISTS github_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event text NOT NULL,
    delivery_id text,
    payload jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_github_webhook_events_event
    ON github_webhook_events(event);
CREATE INDEX IF NOT EXISTS idx_github_webhook_events_created_at
    ON github_webhook_events(created_at DESC);

-- Repository-backed projects / workspaces.
CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    github_installation_id bigint NOT NULL,
    repository_id bigint NOT NULL,
    owner text NOT NULL,
    repository text NOT NULL,
    default_branch text NOT NULL DEFAULT 'main',
    working_branch text NOT NULL,
    workspace_id text,
    vercel_project_id text,
    status text NOT NULL DEFAULT 'offline',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (user_id, repository_id)
);

CREATE INDEX IF NOT EXISTS idx_projects_user
    ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status
    ON projects(status);

-- Enable Row Level Security
ALTER TABLE github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Service-role bypass policies (used by server-side API routes with Clerk auth)
DROP POLICY IF EXISTS service_role_all_github_installations ON github_installations;
CREATE POLICY service_role_all_github_installations
    ON github_installations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_github_webhook_events ON github_webhook_events;
CREATE POLICY service_role_all_github_webhook_events
    ON github_webhook_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_projects ON projects;
CREATE POLICY service_role_all_projects
    ON projects
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Optional: anon policies can be added after migration if the app exposes any of these tables directly.
