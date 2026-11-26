/**
 * Minimal thenable fake of the Supabase query builder — just enough
 * of the chain surface for Sentinel store/repairs/leader unit tests.
 * NOT for production use; lives beside the tests that consume it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let idCounter = 0;

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row[] = [];
  private patch: Row | null = null;
  private orderSpec: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private mode: "list" | "single" | "maybe" = "list";

  constructor(private rows: Row[]) {}

  select(): this {
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderSpec = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = "insert";
    this.payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.patch = { ...patch };
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }): this {
    this.op = "upsert";
    this.payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
    void opts;
    return this;
  }
  single(): Promise<{ data: unknown; error: unknown }> {
    this.mode = "single";
    return this.execute();
  }
  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    this.mode = "maybe";
    return this.execute();
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matched(): Row[] {
    return this.rows.filter((r) => this.filters.every((f) => f(r)));
  }

  private execute(): Promise<{ data: unknown; error: unknown }> {
    try {
      if (this.op === "insert") {
        for (const r of this.payload) {
          if (r.id === undefined) r.id = `fake-${++idCounter}`;
          this.rows.push(r);
        }
        const inserted = this.payload;
        return Promise.resolve({
          data: this.mode === "list" ? inserted : this.mode === "single" ? inserted[0] ?? null : inserted[0] ?? null,
          error: null,
        });
      }
      if (this.op === "upsert") {
        for (const r of this.payload) {
          const key = r.id ?? r.service_id;
          const idx = this.rows.findIndex((row) => row.id === key || row.service_id === key);
          if (idx >= 0) this.rows[idx] = { ...this.rows[idx], ...r };
          else this.rows.push({ ...r });
        }
        return Promise.resolve({ data: this.payload, error: null });
      }
      if (this.op === "update") {
        for (const r of this.matched()) Object.assign(r, this.patch);
        return Promise.resolve({ data: null, error: null });
      }
      // select
      let out = this.matched();
      if (this.orderSpec) {
        const { col, asc } = this.orderSpec;
        out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
      }
      if (this.lim !== null) out = out.slice(0, this.lim);
      if (this.mode === "single") return Promise.resolve({ data: out[0] ?? null, error: null });
      if (this.mode === "maybe") return Promise.resolve({ data: out[0] ?? null, error: null });
      return Promise.resolve({ data: out, error: null });
    } catch (err) {
      return Promise.resolve({ data: null, error: err });
    }
  }
}

export interface FakeSupabase {
  client: {
    from: (table: string) => FakeQuery;
  };
  tables: Record<string, Row[]>;
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeSupabase {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  return {
    tables,
    client: {
      from(table: string) {
        if (!tables[table]) tables[table] = [];
        return new FakeQuery(tables[table]);
      },
    },
  };
}
