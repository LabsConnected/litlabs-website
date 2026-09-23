/**
 * SecretBroker project-secrets tests.
 *
 * Uses an in-memory fake Supabase client (the broker accepts any client in
 * its constructor). Covers:
 *  - upsert → encrypted at rest (stored row is NOT plaintext)
 *  - decrypt round-trip via resolveForSandbox
 *  - write path feeds the #450 read path (extractClerkEnvFromSecrets)
 *  - listProjectSecrets never leaks values
 *  - delete removes the secret
 *
 * Run: npx vitest run src/lib/terminal-v1/__tests__/secret-broker.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SecretBroker } from "../secret-broker";
import { extractClerkEnvFromSecrets } from "../../preview-clerk-env";

// Encryption needs a 32+ char server key.
process.env.TERMINAL_SECRET_KEY = "test-terminal-secret-key-32-chars-min!!";

// ─── Minimal in-memory Supabase fake ────────────────────────────────
// Supports exactly the query chains SecretBroker uses:
//   insert().select().single()
//   select().eq()….maybeSingle() / .single()
//   select().eq()….order()            (awaited directly)
//   select().eq().or().order()       (awaited directly)
//   update().eq()….                  (awaited directly)
//   delete().eq()….                  (awaited directly)

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private orderKey: string | null = null;
  private orderAsc = true;
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;

  constructor(private table: Row[]) {}

  select(): this {
    // insert().select() means "insert and return the row" — keep op.
    return this;
  }
  insert(row: Row): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(obj: Row): this {
    this.op = "update";
    this.payload = obj;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  or(expr: string): this {
    const parts = expr.split(",");
    this.filters.push((r) =>
      parts.some((p) => {
        const [col, op, ...rest] = p.split(".");
        const val = rest.join(".");
        if (op === "is" && val === "null") return r[col] == null;
        if (op === "eq") return String(r[col]) === val;
        return false;
      }),
    );
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderKey = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  private run(): Row[] {
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert" && this.payload) {
      const row = { ...this.payload };
      this.table.push(row);
      rows = [row];
    } else if (this.op === "update" && this.payload) {
      for (const r of rows) Object.assign(r, this.payload);
    } else if (this.op === "delete") {
      for (const r of rows) {
        const i = this.table.indexOf(r);
        if (i >= 0) this.table.splice(i, 1);
      }
    }
    if (this.orderKey) {
      const key = this.orderKey;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const av = String(a[key] ?? "");
        const bv = String(b[key] ?? "");
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return rows;
  }

  single(): Promise<{ data: Row | null; error: null }> {
    const rows = this.run();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.run();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  // Makes `await query` work for order()/update()/delete() terminals.
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    resolve?: ((v: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((e: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.run(), error: null }).then(resolve, reject);
  }
}

class FakeClient {
  constructor(private tables: Record<string, Row[]>) {}
  from(table: string): FakeQuery {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQuery(this.tables[table]);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

const USER = "user_123";
const PROJECT = "proj_abc";
const OTHER_PROJECT = "proj_other";

let tables: Record<string, Row[]>;
let broker: SecretBroker;

beforeEach(() => {
  tables = {};
  // Cast: the broker only needs the `from` surface we fake above.
  broker = new SecretBroker(new FakeClient(tables) as never);
});

describe("upsertProjectSecret", () => {
  it("stores the value encrypted at rest — never plaintext in the row", async () => {
    const plaintext = "sk_live_supersecret123";
    const meta = await broker.upsertProjectSecret({
      userId: USER,
      projectId: PROJECT,
      name: "CLERK_SECRET_KEY",
      value: plaintext,
    });

    expect(meta.name).toBe("CLERK_SECRET_KEY");
    expect(meta.projectId).toBe(PROJECT);

    const rows = tables["terminal_secrets"];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // The stored payload must not contain or equal the plaintext.
    expect(row["encrypted_value"]).not.toBe(plaintext);
    expect(String(row["encrypted_value"])).not.toContain(plaintext);
    expect(JSON.stringify(row)).not.toContain(plaintext);
    // But the crypto envelope is present.
    expect(row["encryption_iv"]).toBeTruthy();
    expect(row["encryption_tag"]).toBeTruthy();
  });

  it("round-trips: decryptValue returns the original plaintext", async () => {
    const meta = await broker.upsertProjectSecret({
      userId: USER,
      projectId: PROJECT,
      name: "CLERK_SECRET_KEY",
      value: "sk_live_roundtrip",
    });
    await expect(broker.decryptValue(meta.secretId, USER)).resolves.toBe("sk_live_roundtrip");
  });

  it("replaces the value on second upsert instead of duplicating", async () => {
    await broker.upsertProjectSecret({ userId: USER, projectId: PROJECT, name: "CLERK_SECRET_KEY", value: "sk_old" });
    await broker.upsertProjectSecret({ userId: USER, projectId: PROJECT, name: "CLERK_SECRET_KEY", value: "sk_new" });

    expect(tables["terminal_secrets"]).toHaveLength(1);
    const resolved = await broker.resolveForSandbox(USER, PROJECT);
    expect(resolved["CLERK_SECRET_KEY"]).toBe("sk_new");
  });

  it("scopes secrets to the project — same name in another project is separate", async () => {
    await broker.upsertProjectSecret({ userId: USER, projectId: PROJECT, name: "CLERK_SECRET_KEY", value: "sk_a" });
    await broker.upsertProjectSecret({ userId: USER, projectId: OTHER_PROJECT, name: "CLERK_SECRET_KEY", value: "sk_b" });

    expect(tables["terminal_secrets"]).toHaveLength(2);
    expect((await broker.resolveForSandbox(USER, PROJECT))["CLERK_SECRET_KEY"]).toBe("sk_a");
    expect((await broker.resolveForSandbox(USER, OTHER_PROJECT))["CLERK_SECRET_KEY"]).toBe("sk_b");
  });
});

describe("write path feeds the #450 preview read path", () => {
  it("upsert → resolveForSandbox → extractClerkEnvFromSecrets yields the Clerk subset", async () => {
    await broker.upsertProjectSecret({
      userId: USER, projectId: PROJECT, name: "CLERK_SECRET_KEY", value: "sk_live_abc",
    });
    await broker.upsertProjectSecret({
      userId: USER, projectId: PROJECT, name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", value: "pk_live_xyz",
    });
    await broker.upsertProjectSecret({
      userId: USER, projectId: PROJECT, name: "OPENAI_API_KEY", value: "unrelated",
    });

    const secrets = await broker.resolveForSandbox(USER, PROJECT);
    const clerkEnv = extractClerkEnvFromSecrets(secrets);

    expect(clerkEnv).toEqual({
      CLERK_SECRET_KEY: "sk_live_abc",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_xyz",
    });
  });
});

describe("listProjectSecrets", () => {
  it("returns metadata only — values never leak", async () => {
    await broker.upsertProjectSecret({
      userId: USER, projectId: PROJECT, name: "CLERK_SECRET_KEY", value: "sk_live_noleak",
    });

    const metas = await broker.listProjectSecrets(USER, PROJECT);
    expect(metas).toHaveLength(1);
    const dumped = JSON.stringify(metas);
    expect(dumped).not.toContain("sk_live_noleak");
    expect(dumped).toContain("CLERK_SECRET_KEY");
  });

  it("excludes other projects' and user-scoped secrets", async () => {
    await broker.upsertProjectSecret({ userId: USER, projectId: PROJECT, name: "A", value: "1" });
    await broker.upsertProjectSecret({ userId: USER, projectId: OTHER_PROJECT, name: "B", value: "2" });
    await broker.create({ userId: USER, name: "C", value: "3" }); // user-scoped

    const metas = await broker.listProjectSecrets(USER, PROJECT);
    expect(metas.map((m) => m.name)).toEqual(["A"]);
  });
});

describe("delete", () => {
  it("removes the secret so resolution no longer sees it", async () => {
    const meta = await broker.upsertProjectSecret({
      userId: USER, projectId: PROJECT, name: "CLERK_SECRET_KEY", value: "sk_live_gone",
    });
    await broker.delete(meta.secretId, USER);

    expect(tables["terminal_secrets"]).toHaveLength(0);
    const resolved = await broker.resolveForSandbox(USER, PROJECT);
    expect(resolved["CLERK_SECRET_KEY"]).toBeUndefined();
  });
});
