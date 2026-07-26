-- Marketplace capability tables — replaces fake agent-based marketplace.
-- LiTT and Spark are the only primary assistants. Marketplace items are
-- installable capabilities (skills, tools, workflows, integrations, creative packs).

CREATE TABLE IF NOT EXISTS marketplace_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    item_type text NOT NULL DEFAULT 'skill' CHECK (item_type IN ('skill','tool','workflow','template','integration','creative_pack')),
    category text NOT NULL DEFAULT 'general',
    status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','coming_soon','unavailable','beta')),
    compatible_assistants text[] NOT NULL DEFAULT '{litt}',
    capability_key text NOT NULL,
    version text NOT NULL DEFAULT '1.0.0',
    icon text NOT NULL DEFAULT '📦',
    author_name text NOT NULL DEFAULT 'LiTTree Labs',
    author_id text,
    is_featured boolean NOT NULL DEFAULT false,
    is_official boolean NOT NULL DEFAULT true,
    is_beta boolean NOT NULL DEFAULT true,
    price_cents integer NOT NULL DEFAULT 0,
    config_schema jsonb NOT NULL DEFAULT '{}',
    permissions text[] NOT NULL DEFAULT '{}',
    required_connections text[] NOT NULL DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_items_slug ON marketplace_items(slug);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_type ON marketplace_items(item_type);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_category ON marketplace_items(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_status ON marketplace_items(status);

CREATE TABLE IF NOT EXISTS marketplace_installations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    marketplace_item_id uuid NOT NULL REFERENCES marketplace_items(id) ON DELETE CASCADE,
    project_id uuid,
    enabled boolean NOT NULL DEFAULT true,
    configuration jsonb NOT NULL DEFAULT '{}',
    installed_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (user_id, marketplace_item_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_installs_user ON marketplace_installations(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_installs_item ON marketplace_installations(marketplace_item_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_installs_user_enabled ON marketplace_installations(user_id, enabled);

-- RLS: service_role bypass — auth enforced in Next.js API routes via Clerk
ALTER TABLE marketplace_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_installations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_marketplace_items ON marketplace_items;
CREATE POLICY service_role_all_marketplace_items ON marketplace_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_marketplace_installs ON marketplace_installations;
CREATE POLICY service_role_all_marketplace_installs ON marketplace_installations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed real beta capability items
INSERT INTO marketplace_items (slug, name, description, item_type, category, status, compatible_assistants, capability_key, version, icon, is_featured, is_beta, required_connections)
VALUES
  ('github-code-review', 'GitHub Code Review', 'Reviews real repository changes, explains risks, and suggests fixes before merge.', 'tool', 'development', 'available', '{litt}', 'github.code_review', '1.0.0', '🔍', true, true, '{github}'),
  ('github-repo-search', 'Repository Search', 'Search across connected repositories for files, functions, and patterns.', 'tool', 'development', 'available', '{litt}', 'github.repository_search', '1.0.0', '🔎', false, true, '{github}'),
  ('build-test-workflow', 'Build and Test Workflow', 'Runs build and test suites in the terminal, reports results, and flags failures.', 'workflow', 'automation', 'available', '{litt}', 'workflow.build_test', '1.0.0', '🔨', true, true, '{terminal}'),
  ('landing-page-builder', 'Landing Page Builder', 'Generates a complete landing page with responsive design and deployment config.', 'workflow', 'development', 'available', '{litt}', 'workflow.landing_page', '1.0.0', '📄', false, true, '{}'),
  ('social-content-planner', 'Social Content Planner', 'Plans and drafts social posts across platforms with scheduling suggestions.', 'workflow', 'creative', 'available', '{spark}', 'content.social_plan', '1.0.0', '📅', false, true, '{}'),
  ('brand-kit-generator', 'Brand Kit Generator', 'Creates color palettes, typography pairings, and visual identity guidelines.', 'creative_pack', 'creative', 'available', '{spark}', 'creative.brand_kit', '1.0.0', '🎨', true, true, '{}'),
  ('writing-polish', 'Writing Polish', 'Edits and improves copy for clarity, tone, and impact.', 'skill', 'creative', 'available', '{spark}', 'content.copy_edit', '1.0.0', '✍️', false, true, '{}'),
  ('vercel-deploy', 'Vercel Deployment', 'Deploy projects directly to Vercel from Studio with environment management.', 'integration', 'development', 'coming_soon', '{litt}', 'vercel.deploy', '0.9.0', '▲', false, true, '{vercel}'),
  ('supabase-setup', 'Supabase Setup', 'Configure database schemas, RLS policies, and API endpoints for new projects.', 'integration', 'development', 'coming_soon', '{litt}', 'supabase.schema_assist', '0.9.0', '🗄️', false, true, '{supabase}')
ON CONFLICT (slug) DO NOTHING;
