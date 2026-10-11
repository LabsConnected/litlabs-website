import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "supabase/migrations");

const SOCIAL_TABLES = [
  "post_reposts",
  "post_saves",
  "post_reactions",
  "post_polls",
  "poll_options",
  "poll_votes",
  "comment_likes",
] as const;

const SOCIAL_MIGRATION = "20260916010000_social_phase1.sql";
const HELPER_MIGRATION = "20260702130000_rls_policies_clerk_service_role.sql";
const VIEW_MIGRATION = "20260714030000_usage_stats_schema_fixes.sql";
const FIX_MIGRATION = "20260928010000_enable_rls_social_tables_and_usage_view.sql";
const SOCIAL_GRAPH_MIGRATION = "20240614030000_social_graph.sql";

const COUNTER_RPCS = [
  { name: "increment_post_reposts", signature: "public.increment_post_reposts(post_id uuid)", callers: ["src/app/api/posts/[id]/repost/route.ts"] },
  { name: "decrement_post_reposts", signature: "public.decrement_post_reposts(post_id uuid)", callers: ["src/app/api/posts/[id]/repost/route.ts"] },
  { name: "increment_post_saves", signature: "public.increment_post_saves(post_id uuid)", callers: ["src/app/api/posts/[id]/save/route.ts"] },
  { name: "decrement_post_saves", signature: "public.decrement_post_saves(post_id uuid)", callers: ["src/app/api/posts/[id]/save/route.ts"] },
  { name: "increment_post_shares", signature: "public.increment_post_shares(post_id uuid)", callers: ["src/app/api/posts/[id]/share/route.ts"] },
  { name: "increment_poll_option_votes", signature: "public.increment_poll_option_votes(option_id uuid)", callers: ["src/app/api/posts/[id]/poll/vote/route.ts"] },
  { name: "increment_comment_likes", signature: "public.increment_comment_likes(comment_id uuid)", callers: ["src/app/api/posts/comments/[commentId]/like/route.ts"] },
  { name: "decrement_comment_likes", signature: "public.decrement_comment_likes(comment_id uuid)", callers: ["src/app/api/posts/comments/[commentId]/like/route.ts"] },
] as const;

function readMigration(name: string): string {
  return fs.readFileSync(path.join(migrationsDir, name), "utf8");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("social phase-1 RLS and usage_daily_summary", () => {
  it("creates deny policies without enabling RLS on the success path", () => {
    const sql = readMigration(SOCIAL_MIGRATION);
    const successPath = sql.split("EXCEPTION WHEN undefined_function")[0];
    expect(successPath).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    for (const table of SOCIAL_TABLES) {
      expect(successPath).toContain(`_rls_deny_client_access('${table}')`);
    }
    expect(sql).toMatch(/EXCEPTION WHEN undefined_function/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it("defines _rls_deny_client_access as policy-only", () => {
    const helper = readMigration(HELPER_MIGRATION);
    const match = helper.match(
      /CREATE OR REPLACE FUNCTION public\._rls_deny_client_access\(table_name text\)[\s\S]*?\$\$;/,
    );
    expect(match).toBeTruthy();
    expect(match![0]).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(match![0]).toContain("api_deny_anon");
    expect(match![0]).toContain("api_deny_authenticated");
  });

  it("creates usage_daily_summary without security_invoker", () => {
    const sql = readMigration(VIEW_MIGRATION);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.usage_daily_summary AS/);
    expect(sql).not.toMatch(/security_invoker/i);
  });

  it("forward migration enables RLS, restores deny policies, and locks the view", () => {
    const sql = readMigration(FIX_MIGRATION);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toContain("api_deny_anon");
    expect(sql).toContain("api_deny_authenticated");
    expect(sql).toMatch(/USING \(false\) WITH CHECK \(false\)/);
    expect(sql).toMatch(/ALTER VIEW public\.usage_daily_summary SET \(security_invoker = true\)/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.usage_daily_summary FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.usage_daily_summary FROM anon/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.usage_daily_summary FROM authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.usage_daily_summary TO service_role/);
    expect(sql).not.toMatch(/CREATE OR REPLACE VIEW/i);
    expect(sql).not.toMatch(/DROP VIEW/i);
    for (const table of SOCIAL_TABLES) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("does not enable RLS for these tables in any earlier migration success path", () => {
    const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      if (name === FIX_MIGRATION) continue;
      const sql = readMigration(name);
      const mentionsTable = SOCIAL_TABLES.some((table) => sql.includes(table));
      if (!mentionsTable || !/ENABLE ROW LEVEL SECURITY/i.test(sql)) continue;
      expect(name).toBe(SOCIAL_MIGRATION);
      const successPath = sql.split("EXCEPTION WHEN undefined_function")[0];
      expect(successPath).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    }
  });

  it("application queries of the seven tables go through the service-role client", () => {
    const srcDir = path.join(root, "src");
    const hits: string[] = [];
    const offenders: string[] = [];
    for (const file of walkTs(srcDir)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      const referenced = SOCIAL_TABLES.filter(
        (table) => text.includes(`"${table}"`) || text.includes(`'${table}'`),
      );
      if (referenced.length === 0) continue;
      hits.push(path.relative(root, file));
      const usesServiceRole =
        text.includes("getAdminSupabase") ||
        text.includes("getSupabaseAdmin") ||
        text.includes("supabaseAdmin");
      const usesAnonClient = text.includes("getSupabase()") || text.includes("postgres_changes");
      if (!usesServiceRole || usesAnonClient) offenders.push(path.relative(root, file));
    }
    expect(hits.sort()).toEqual(
      [
        "src/app/api/posts/[id]/comments/route.ts",
        "src/app/api/posts/[id]/poll/vote/route.ts",
        "src/app/api/posts/[id]/reactions/route.ts",
        "src/app/api/posts/[id]/repost/route.ts",
        "src/app/api/posts/[id]/save/route.ts",
        "src/app/api/posts/comments/[commentId]/like/route.ts",
        "src/app/api/posts/route.ts",
        "src/lib/social-feed.ts",
      ].sort(),
    );
    expect(offenders).toEqual([]);
  });

  it("locks the eight social counter RPCs to service_role", () => {
    const social = readMigration(SOCIAL_MIGRATION);
    const fix = readMigration(FIX_MIGRATION);
    const graph = readMigration(SOCIAL_GRAPH_MIGRATION);
    expect(social.match(/SECURITY DEFINER/g)).toHaveLength(8);
    expect(social).not.toMatch(/REVOKE EXECUTE/i);
    expect(graph).not.toMatch(/SECURITY DEFINER/i);
    expect(fix).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(increment|decrement)_/i);
    for (const rpc of COUNTER_RPCS) {
      const body = social.slice(social.indexOf(`FUNCTION ${rpc.signature}`));
      expect(body.startsWith(`FUNCTION ${rpc.signature}`)).toBe(true);
      expect(body.slice(0, 400)).toMatch(/SECURITY DEFINER/);
      expect(body.slice(0, 400)).toMatch(/SET search_path = ''/);
      expect(fix).toContain(
        `REVOKE EXECUTE ON FUNCTION ${rpc.signature} FROM PUBLIC, anon, authenticated;`,
      );
      expect(fix).toContain(`GRANT EXECUTE ON FUNCTION ${rpc.signature} TO service_role;`);
    }
  });

  it("calls the counter RPCs only through the service-role client", () => {
    const callers = new Map<string, string[]>();
    for (const file of walkTs(path.join(root, "src"))) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const rpc of COUNTER_RPCS) {
        if (!text.includes(`"${rpc.name}"`) && !text.includes(`'${rpc.name}'`)) continue;
        const rel = path.relative(root, file);
        callers.set(rpc.name, [...(callers.get(rpc.name) ?? []), rel]);
        const usesServiceRole =
          text.includes("getAdminSupabase") ||
          text.includes("getSupabaseAdmin") ||
          text.includes("supabaseAdmin");
        expect(usesServiceRole, rel).toBe(true);
        expect(text.includes("getSupabase()"), rel).toBe(false);
      }
    }
    for (const rpc of COUNTER_RPCS) {
      expect(callers.get(rpc.name)?.sort()).toEqual([...rpc.callers].sort());
    }
  });

  it("no application source queries usage_daily_summary", () => {
    const hits: string[] = [];
    for (const file of walkTs(path.join(root, "src"))) {
      const text = fs.readFileSync(file, "utf8");
      if (text.includes("usage_daily_summary")) hits.push(path.relative(root, file));
    }
    expect(hits).toEqual([]);
  });
});
