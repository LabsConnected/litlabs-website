// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
const exec = promisify(execFile);
const container = `litt-global-foundation-${process.pid}`;
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ userId: "integration-user", clerkId: "integration-user" }) }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: mocks.from } }));
import { GET } from "@/app/api/global-litt/route";
const quote = (value: unknown) => value === null ? "NULL" : typeof value === "boolean" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
async function sql(query: string) {
  const { stdout } = await exec("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At", "-c", query], { timeout: 30000 });
  return stdout.trim();
}
let migration: string;
beforeAll(async () => {
  await exec("docker", ["run", "-d", "--name", container, "--network", "none", "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD=isolated-test-only", process.env.LITT_TEST_POSTGRES_IMAGE ?? "postgres:17"], { timeout: 120000 });
  for (let i = 0; i < 60; i++) { try { const logs = await exec("docker", ["logs", container]); if (!`${logs.stdout}${logs.stderr}`.includes("PostgreSQL init process complete")) throw new Error("initializing"); await sql("SELECT 1"); break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); } }
  const base = await readFile("supabase/migrations/20260720000000_studio_projects_github.sql", "utf8");
  await sql(base.slice(base.indexOf("CREATE TABLE IF NOT EXISTS public.studio_projects"), base.indexOf("CREATE INDEX IF NOT EXISTS studio_projects_user_id_idx")));
  await sql(await readFile("supabase/migrations/20260721160000_studio_projects_workspace_runtime.sql", "utf8"));
  await sql(await readFile("supabase/migrations/20260726230000_canonical_project_source.sql", "utf8"));
  migration = await readFile("supabase/migrations/20261003200000_global_litt_system_project.sql", "utf8");
  await sql("INSERT INTO studio_projects(user_id,name,slug) VALUES ('existing-user','Existing','existing')");
}, 150000);
afterAll(async () => { await exec("docker", ["rm", "-f", container]).catch(() => undefined); });
it("replays additively, preserves existing rows, and supports transaction rollback", async () => {
  await sql(`BEGIN; ${migration} ROLLBACK;`);
  expect(await sql("SELECT count(*) FROM information_schema.columns WHERE table_name='studio_projects' AND column_name='is_system'")).toBe("0");
  await sql(migration); await sql(migration);
  expect(await sql("SELECT is_system::text || ':' || (system_type IS NULL)::text FROM studio_projects WHERE user_id='existing-user'")).toBe("false:true");
});
it("actual route first creation and simultaneous requests resolve one canonical row", async () => {
  await sql("INSERT INTO studio_projects(user_id,name,slug,is_system,system_type,scan_status) VALUES ('other-user','Other Global','global-litt',true,'global_litt','pending')");
  const otherBefore = await sql("SELECT row_to_json(p) FROM studio_projects p WHERE user_id='other-user'");
  let reads = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  mocks.from.mockImplementation(() => {
    const filters: Array<[string, unknown]> = [];
    let inserted: Record<string, unknown> | null = null;
    let columns = "*";
    const execute = async () => {
      try {
        const statement = inserted
          ? `INSERT INTO studio_projects (${Object.keys(inserted).join(",")}) VALUES (${Object.values(inserted).map(quote).join(",")}) RETURNING ${columns}`
          : `SELECT ${columns} FROM studio_projects WHERE ${filters.map(([key,value]) => `${key}=${quote(value)}`).join(" AND ")}`;
        const output = await sql(inserted ? `WITH r AS (${statement}) SELECT row_to_json(r) FROM r` : `SELECT row_to_json(r) FROM (${statement}) r`);
        if (!inserted && ++reads <= 2) { if (reads === 2) release(); await barrier; }
        return { data: output ? JSON.parse(output) : null, error: null };
      } catch (error) {
        const text = String((error as { stderr?: string }).stderr ?? error);
        return { data: null, error: { code: text.includes("23505") ? "23505" : "DB_ERROR", message: text } };
      }
    };
    const chain = { select(value = "*") { columns = value; return chain; }, eq(key: string,value: unknown) { filters.push([key,value]); return chain; }, insert(value: Record<string,unknown>) { inserted = value; return chain; }, single: execute, maybeSingle: execute };
    return chain;
  });
  const [a,b] = await Promise.all([GET(new NextRequest("http://localhost/api/global-litt")),GET(new NextRequest("http://localhost/api/global-litt"))]);
  expect(a.status).toBe(200); expect(b.status).toBe(200);
  const first = await a.json(), second = await b.json();
  expect(first.project.id).toBe(second.project.id);
  expect(await sql("SELECT count(*) FROM studio_projects WHERE user_id='integration-user' AND is_system AND system_type='global_litt'")).toBe("1");
  expect(await sql("SELECT scan_status || ':' || source_type || ':' || access_mode FROM studio_projects WHERE user_id='integration-user'")).toBe("pending:blank:private");
  expect(await sql("SELECT row_to_json(p) FROM studio_projects p WHERE user_id='other-user'")).toBe(otherBefore);
  await expect(sql("INSERT INTO studio_projects(user_id,name,slug,is_system,system_type) VALUES ('integration-user','Duplicate','global-litt',true,'global_litt')")).rejects.toMatchObject({ stderr: expect.stringContaining("23505") });
  expect((await GET(new NextRequest("http://localhost/api/global-litt"))).status).toBe(200);
}, 30000);


it("enforces marker pairing and retains the actual scan-status constraint", async () => {
  await expect(sql("INSERT INTO studio_projects(user_id,name,slug,is_system) VALUES ('invalid','Missing type','bad',true)")).rejects.toMatchObject({ stderr: expect.stringContaining("23514") });
  await expect(sql("INSERT INTO studio_projects(user_id,name,slug,is_system,system_type) VALUES ('invalid','Ordinary with type','bad',false,'global_litt')")).rejects.toMatchObject({ stderr: expect.stringContaining("23514") });
  await expect(sql("INSERT INTO studio_projects(user_id,name,slug,scan_status) VALUES ('invalid','Bad scan','bad','complete')")).rejects.toMatchObject({ stderr: expect.stringContaining("23514") });
  expect(await sql("SELECT count(*) FROM studio_projects WHERE user_id='existing-user' AND NOT is_system AND system_type IS NULL")).toBe("1");
});
